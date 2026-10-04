/**
 * ESS v16 engine simulator — the single DSP core used by the live AudioWorklet,
 * offline export and the server renderer.
 *
 * Per audio sample: integrate crank speed from indicated torque, step every
 * cylinder against its exhaust primary and intake runner, solve the intake,
 * forced-induction and exhaust networks, then radiate the outlet, intake-mouth,
 * structural and accessory monopoles to the chosen listener.
 */
import type { EngineSpec } from "./spec";
import { cycleDegrees, displacementLitres } from "./spec";
import { solveFiringSchedule } from "./geometry";
import type { FiringSchedule } from "./geometry";
import { Cylinder, mbtAdvance } from "./cylinder";
import type { CombustionCommand } from "./cylinder";
import { BandNoise, P_AMBIENT, Rng, clamp, lerpTable } from "./gas";
import { IntakeSystem } from "./intake";
import { ExhaustNetwork } from "./exhaust";
import { StructuralRadiator } from "./structure";
import { ENGINE_POSITION, INTAKE_MOUTH_POSITION, Observer } from "./observer";
import type { Perspective, SourceDef } from "./observer";
import { Drivetrain } from "./vehicle";
import { createForcedInduction } from "./forcedInduction";
import type { ForcedInductionModel } from "./forcedInduction";

export type DriveMode = "free" | "dyno" | "vehicle";

export interface EngineControls {
  /** Accelerator pedal 0..1. */
  throttle: number;
  /** External load 0..1 (free mode: road/brake load; ignored in dyno mode). */
  load: number;
  /** Dyno speed set-point, rpm. */
  targetRpm: number;
  mode: DriveMode;
  /** Live override of a valved exhaust (sport button); defaults to the build's mode. */
  exhaustValve?: "auto" | "open" | "closed";
  /** Vehicle mode: automatic upshifts at the shift point and coast downshifts. */
  autoShift?: boolean;
  /** Vehicle mode: launch control (ignition-cut hold at launch speed while standing). */
  launchControl?: boolean;
  /** Vehicle mode: brake pedal 0..1. */
  brake?: number;
}

export interface EngineTelemetry {
  rpm: number;
  mapKpa: number;
  boostKpa: number;
  torqueNm: number;
  powerKw: number;
  lambda: number;
  egtC: number;
  throttlePlate: number;
  fuelCut: boolean;
  limiter: boolean;
  afterfire: number;
  turboRpm: number;
  imepBar: number;
  peakPressureBar: number;
  /** Mean location of peak pressure, degrees ATDC. */
  peakPressureAngle: number;
  /** Measured brake torque (dyno absorber in dyno mode), N·m. */
  brakeTorqueNm: number;
  volumetricEfficiency: number;
  /** Mean knock-control spark retard across cylinders, degrees. */
  knockRetardDeg: number;
  /** Running, cranking on the starter, or off. */
  engineState: "running" | "cranking" | "off";
  /** Vehicle mode: engaged gear (0 = neutral), road speed and clutch engagement. */
  gear: number;
  speedKmh: number;
  clutch: number;
  shifting: boolean;
  /** Exhaust bypass flap position 0 (closed) … 1 (open); 0 when the build has no valve. */
  exhaustValve: number;
  /** Cam phaser positions (crank degrees) and lift-switch state. */
  intakeCamAdvanceDeg: number;
  exhaustCamRetardDeg: number;
  highCam: boolean;
  /** Knock onsets since the simulator started. */
  knockEvents: number;
  splDb: number;
}

/** Per-layer monitor gains (stems). Physics is unaffected; only what reaches the listener. */
export interface StemGains {
  exhaust: number;
  exhaustJet: number;
  valveJet: number;
  intake: number;
  structure: number;
  accessory: number;
}

export interface SimulatorOptions {
  perspective?: Perspective;
  /** Extra monitor gain, dB (does not change physics). */
  monitorGainDb?: number;
}

const BLOCK = 64;
const TWO_PI = Math.PI * 2;

export class EngineSimulator {
  readonly spec: EngineSpec;
  readonly schedule: FiringSchedule;
  readonly sampleRate: number;
  readonly displacementL: number;
  private readonly cylinders: Cylinder[];
  /** Crank degrees per working cycle (720 four-stroke, 360 two-stroke). */
  private readonly cycleDeg: number;
  private readonly intake: IntakeSystem;
  private readonly exhaust: ExhaustNetwork;
  private readonly structure: StructuralRadiator;
  private readonly fi: ForcedInductionModel | null;
  private observer: Observer;
  private readonly rng: Rng;
  private readonly valveJets: BandNoise[];
  private readonly allDucts;
  private readonly pressureRates: Float64Array;
  private readonly sourceQdot: Float64Array;
  private readonly sourceDefs: SourceDef[];
  private readonly ear = new Float64Array(2);

  // Mechanical state
  private crankDeg = 0;
  private omega: number;
  private indicatedTorque = 0;
  private torqueRipple = 0;
  private absorberIntegral = 0;
  private controls: EngineControls = { throttle: 0, load: 0, targetRpm: 900, mode: "free" };

  // ECU state
  private idleIntegral = 0.3;
  private readonly idleFeedForward: number;
  private lastBlockRpm = 0;
  private overrunTimer = 0;
  private fuelCutAge = 0;
  private dashpot = 0;
  private idleMapTarget = 32_000;
  private sinceLift = 10;
  private bypassAuthority = 1;
  /** Burned gas mixed into the plenum by reversion (kg) and the plenum's gas mass estimate. */
  private plenumBurned = 0;
  private plenumGasMass = 0.004;
  /** Idle-speed control gains (air PI + speed damping, spark P + D). */
  readonly idleGains = { kp: 0.1, ki: 0.15, kd: 0.04, spark: 40, sparkD: 0 };
  private ecuRpm = 800;
  private lastPedal = 0;
  private bypass = 0.3;
  private slowRpm = 0;
  // Valve timing actuators
  private intakeCamAdvance = 0;
  private exhaustCamRetard = 0;
  private highCamRequest = false;
  private highCamTimer = 0;
  private highCam = false;
  private exhaustValvePos = 0;
  // Start / stop
  /** Engine running (fuel and spark enabled by the ECU). */
  running = true;
  /** Starter engaged. */
  cranking = false;
  private crankTime = 0;
  private startFlare = 0;
  readonly drivetrain: Drivetrain;
  private launchHold: number | null = null;
  private bypassActual = 0.3;
  private fuelCut = false;
  private limiterActive = false;
  private softCutFraction = 0;
  private readonly command: CombustionCommand = { sparkAdvanceDeg: 0, lambda: 1, fuelEnabled: true, sparkEnabled: true, fuelOctane: 95, knockControl: true, injectionAdvanceDeg: 8, fuelMassKg: 0, smokeLambda: 1.2 };
  // Diesel governor state: fuel per cylinder per cycle (kg), its idle feed-forward and integrator.
  private dieselFuel = 0;
  private dieselIdleFF = 0;
  private dieselIdleIntegral = 0;
  private injectionAdvance = 8;
  private sparkAdvance = 15;
  private lambdaTarget = 1;
  private readonly sparkCuts: Uint8Array;

  // Afterfire
  private readonly exhaustFuel: Float64Array;
  private readonly exhaustOxygen: Float64Array;
  private readonly popPulse: Float64Array;
  private readonly popRemaining: Float64Array;
  private afterfireCount = 0;

  // Monitoring
  private sampleIndex = 0;
  private blockExhaustFlow = 0;
  private blockTorque = 0;
  private blockLoad = 0;
  private monitorGain = 1;
  readonly stems: StemGains = { exhaust: 1, exhaustJet: 1, valveJet: 1, intake: 1, structure: 1, accessory: 1 };
  private splAcc = 0;
  private splN = 0;
  readonly telemetry: EngineTelemetry = {
    rpm: 0, mapKpa: 101, boostKpa: 0, torqueNm: 0, powerKw: 0, lambda: 1, egtC: 600, throttlePlate: 0,
    fuelCut: false, limiter: false, afterfire: 0, turboRpm: 0, imepBar: 0, peakPressureBar: 0, peakPressureAngle: 0, brakeTorqueNm: 0, volumetricEfficiency: 0, knockRetardDeg: 0, knockEvents: 0, intakeCamAdvanceDeg: 0, exhaustCamRetardDeg: 0, highCam: false, exhaustValve: 0, engineState: "running", gear: 0, speedKmh: 0, clutch: 0, shifting: false, splDb: 0,
  };

  constructor(spec: EngineSpec, sampleRate: number, options: SimulatorOptions = {}) {
    this.spec = spec;
    this.sampleRate = sampleRate;
    this.rng = new Rng(spec.seed * 2654435761);
    this.schedule = solveFiringSchedule(spec);
    this.cycleDeg = cycleDegrees(spec);
    this.displacementL = displacementLitres(spec);
    const cylParams = {
      boreM: spec.boreMm / 1000,
      strokeM: spec.strokeMm / 1000,
      rodM: spec.rodLengthMm / 1000,
      compressionRatio: spec.compressionRatio,
      cam: spec.cam,
      intakeValves: spec.valves.intakeCount,
      exhaustValves: spec.valves.exhaustCount,
      intakeValveD: spec.valves.intakeDiameterMm / 1000,
      exhaustValveD: spec.valves.exhaustDiameterMm / 1000,
      fuelLhv: spec.fuelLhvMjKg * 1e6,
      stoichAfr: spec.fuelStoichAfr,
      wallTempK: 440,
      diesel: spec.diesel ? { cetane: spec.diesel.cetane, pilot: spec.diesel.pilotInjection } : null,
      cycleDeg: cycleDegrees(spec),
      twoStroke: spec.twoStroke,
      rotary: spec.rotary,
    };
    this.cylinders = this.schedule.cylinders.map((g) => new Cylinder(cylParams, g.fireAngleDeg, new Rng(spec.seed * 7919 + g.number * 104729)));
    // Fixed per-cylinder build offsets (the same engine always has the same "fingerprint").
    const tol = spec.calibration.buildTolerance;
    const build = new Rng(spec.seed * 31337 + 17);
    for (const c of this.cylinders) {
      c.flowScale = 1 + 0.03 * tol * clamp(build.gaussian(), -2.5, 2.5);
      c.burnScale = 1 + 0.05 * tol * clamp(build.gaussian(), -2.5, 2.5);
      c.fuelScale = 1 + 0.025 * tol * clamp(build.gaussian(), -2.5, 2.5);
      // Injector delivery scatter is absolute, so it dominates at small (idle) quantities.
      if (spec.diesel) c.fuelOffsetKg = 2 * tol * spec.diesel.injectorSpreadMg * 1e-6 * clamp(build.gaussian(), -2.5, 2.5);
    }
    this.intake = new IntakeSystem(spec, sampleRate, this.rng);
    this.exhaust = new ExhaustNetwork(spec, this.schedule, sampleRate, this.rng);
    this.fi = createForcedInduction(spec, sampleRate, this.rng, this.exhaust, this.intake);
    this.drivetrain = new Drivetrain(spec.vehicle, spec.calibration.idleRpm, spec.calibration.redlineRpm);
    // Two-strokes have no timing drive or valvetrain: no tooth-pass tone, about half the friction excitation.
    const drive = spec.cycle === "two-stroke" ? { teeth: 0, level: 0.5 } : { teeth: 21, level: 1 };
    this.structure = new StructuralRadiator(sampleRate, this.displacementL, spec.cylinders, this.cylinders[0].area, this.rng, this.schedule.cylinders.map((c) => c.positionM), drive);
    this.valveJets = this.cylinders.map(() => new BandNoise(this.rng, sampleRate, 0.5));
    this.allDucts = [...this.exhaust.ducts(), ...this.intake.ducts(), ...(this.fi?.ducts() ?? [])];
    this.pressureRates = new Float64Array(spec.cylinders);
    this.sparkCuts = new Uint8Array(spec.cylinders);
    this.exhaustFuel = new Float64Array(this.exhaust.groups.length);
    this.exhaustOxygen = new Float64Array(this.exhaust.groups.length);
    this.popPulse = new Float64Array(this.exhaust.groups.length);
    this.popRemaining = new Float64Array(this.exhaust.groups.length);

    this.sourceDefs = [
      ...this.exhaust.outlets.map((o) => ({ kind: "exhaust" as const, position: o.position })),
      { kind: "intake", position: INTAKE_MOUTH_POSITION },
      { kind: "structure", position: ENGINE_POSITION },
      ...(this.fi?.sourceDefs ?? []),
    ];
    this.sourceQdot = new Float64Array(this.sourceDefs.length);
    this.observer = new Observer(sampleRate, options.perspective ?? "exterior-rear", this.sourceDefs);
    this.setMonitorGain(options.monitorGainDb ?? 0);

    // Idle-air feed-forward from the energy balance at idle: gross indicated work must cover
    // mechanical friction, accessories and pumping (≈ exhaust back-pressure − MAP), at the gross
    // efficiency of retarded idle spark (~0.27), lowered by valve-overlap dilution. MAP follows
    // from the airflow (VE ≈ 0.85), so a few fixed-point passes settle pumping and airflow together.
    // The valve area then passes that air through a choked orifice (ṁ ≈ 0.78·A·p0/√(RT)·0.685).
    const overlap = Math.max(0, spec.cam.intakeDurationDeg / 2 - spec.cam.intakeCenterlineDeg) + Math.max(0, spec.cam.exhaustDurationDeg / 2 - spec.cam.exhaustCenterlineDeg);
    const idleOmega = (spec.calibration.idleRpm / 60) * TWO_PI;
    const vd = this.displacementL / 1000;
    const cyclesPerSec = (spec.calibration.idleRpm / 60) * (360 / this.cycleDeg);
    const etaIdle = 0.27 / (1 + overlap / 30);
    const friction = this.frictionTorque(spec.calibration.idleRpm);
    let idleMap = 32_000;
    let idleAir = 0;
    for (let k = 0; k < 6; k++) {
      const pumpingWork = Math.max(0, 104_000 - idleMap) * vd;
      const grossPower = friction * idleOmega + pumpingWork * cyclesPerSec;
      idleAir = (grossPower / (etaIdle * spec.fuelLhvMjKg * 1e6)) * spec.fuelStoichAfr;
      idleMap = clamp((idleAir / (0.85 * vd * cyclesPerSec)) * 287.05 * 310, 18_000, 70_000);
    }
    this.idleMapTarget = idleMap;
    let idleArea = idleAir / (0.78 * (P_AMBIENT / Math.sqrt(287.05 * 298)) * 0.685);
    this.bypassAuthority = 1 + overlap / 25;
    if (spec.twoStroke) {
      // Two-stroke: no cams (no overlap), no throttling pumping loss to cover, and the crankcase pump
      // keeps the manifold near 75 kPa, so the idle air passes the slide subsonically (Δp ≈ 26 kPa).
      const gross = friction * idleOmega;
      // ≈ 22 % gross efficiency at idle, and about half the delivered air short-circuits (trapping ≈ 0.5).
      const air = ((gross / (0.22 * spec.fuelLhvMjKg * 1e6)) * spec.fuelStoichAfr) / 0.5;
      idleArea = air / (0.75 * Math.sqrt(2 * 1.2 * 26_000));
      this.bypassAuthority = 1;
      this.idleMapTarget = 75_000;
    }
    this.intake.setBypassScale(this.bypassAuthority);
    this.idleFeedForward = clamp(idleArea / (spec.intake.idleBypassAreaMm2 * 1e-6 * this.bypassAuthority), 0.05, 0.9);
    // Burned-gas capacity of each runner: its gas mass at idle manifold density.
    const runnerVolume = (Math.PI / 4) * Math.pow(spec.intake.runnerDiameterMm / 1000, 2) * (spec.intake.runnerLengthMm / 1000);
    for (const cyl of this.cylinders) cyl.runnerResidualCapacity = runnerVolume * (this.idleMapTarget / (287.05 * 320));
    if (spec.twoStroke) {
      this.cylinders.forEach((cyl, i) => {
        const header = this.exhaust.primaries[i];
        cyl.headerCapacity = header.area * header.lengthM * (P_AMBIENT / (287.05 * 700));
      });
    }
    this.plenumGasMass = (Math.max(0.3, spec.intake.plenumVolumeL) / 1000) * 1.0;
    this.idleIntegral = this.idleFeedForward;
    this.bypass = this.idleFeedForward;
    this.bypassActual = this.idleFeedForward;

    // Initial state: idle-like manifold pressure, warm cylinders.
    this.omega = (spec.calibration.idleRpm / 60) * TWO_PI;
    this.lastBlockRpm = spec.calibration.idleRpm;
    this.slowRpm = spec.calibration.idleRpm;
    this.ecuRpm = spec.calibration.idleRpm;
    this.controls.targetRpm = spec.calibration.idleRpm;
    this.intake.initialise(34_000);
    this.cylinders.forEach((cyl) => cyl.initialise(this.modCycle(-cyl.fireAngleDeg), 60_000, 420));
  }

  setControls(c: Partial<EngineControls>): void {
    this.controls = { ...this.controls, ...c };
    this.controls.throttle = clamp(this.controls.throttle, 0, 1);
    this.controls.load = clamp(this.controls.load, 0, 1);
  }

  get currentControls(): EngineControls {
    return this.controls;
  }

  setPerspective(perspective: Perspective): void {
    this.observer = new Observer(this.sampleRate, perspective, this.sourceDefs);
  }

  setMonitorGain(db: number): void {
    this.monitorGain = Math.pow(10, db / 20);
  }

  /** Engage the starter (engine stopped): cranks until the engine catches, up to 5 s. */
  start(): void {
    if (this.running) return;
    this.cranking = true;
    this.crankTime = 0;
  }

  /** Ignition off: fuel and spark stop; the engine runs down to rest. */
  stopEngine(): void {
    this.running = false;
    this.cranking = false;
  }

  /**
   * Starter motor reflected to the crank: torque falls linearly from stall to its no-load speed
   * (~320 crank rpm through a ~13:1 pinion/ring-gear), sized with displacement so cranking
   * settles at 200–250 rpm against compression and breakaway friction.
   */
  private starterTorque(rpm: number): number {
    if (!this.cranking) return 0;
    const stall = 40 + 32 * this.displacementL;
    return Math.max(0, stall * (1 - rpm / 320));
  }

  /** Vehicle mode: request an up (+1) or down (−1) shift. */
  shift(dir: 1 | -1): void {
    this.drivetrain.requestShift(dir);
  }

  /**
   * Estimated CPU cost as a real-time factor on the reference machine (fit over the reference
   * engines: 0.11 + 0.050·cylinders + 0.004·ducts + 0.057·turbochargers at 48 kHz, ±25 %).
   * Scales with the sample rate; the worklet multiplies it by a measured machine factor.
   */
  get costEstimate(): number {
    const turbos = this.fi ? this.fi.sourceVolumeAccelerations.length : 0;
    return (0.11 + 0.05 * this.cylinders.length + 0.004 * this.allDucts.length + 0.057 * turbos) * (this.sampleRate / 48000);
  }

  private modCycle(x: number): number {
    const r = x % this.cycleDeg;
    return r < 0 ? r + this.cycleDeg : r;
  }

  get rpm(): number {
    return (this.omega * 60) / TWO_PI;
  }

  /** Run the physics without producing audio (settle temperatures, MAP, idle). */
  prewarm(seconds: number): void {
    const n = Math.round(seconds * this.sampleRate);
    for (let i = 0; i < n; i++) this.tick(false);
  }

  /** Render `count` samples into the output buffers (full-scale units). */
  process(left: Float32Array, right: Float32Array, count = left.length, offset = 0): void {
    for (let i = 0; i < count; i++) {
      this.tick(true);
      const scale = this.observer.paToFullScale * this.monitorGain;
      left[offset + i] = softLimit(this.ear[0] * scale);
      right[offset + i] = softLimit(this.ear[1] * scale);
    }
  }

  private tick(render: boolean): void {
    const fs = this.sampleRate;
    const dt = 1 / fs;
    if (this.sampleIndex % BLOCK === 0) this.blockUpdate();
    this.sampleIndex++;

    // ---- Crank dynamics
    const rpm = (this.omega * 60) / TWO_PI;
    const J = this.spec.inertiaKgM2;
    const frictionTorque = this.frictionTorque(rpm);
    const fiTorque = this.fi ? this.fi.crankTorque : 0;
    if (this.controls.mode === "vehicle") {
      const out = this.drivetrain.step(dt, this.indicatedTorque - frictionTorque - fiTorque, this.omega, J, this.controls.brake ?? 0);
      this.blockLoad += out.clutchTorque;
      this.omega = Math.max(this.running || this.cranking ? 20 : 0, out.omega);
    } else {
      const loadTorque = this.externalLoadTorque(rpm);
      this.blockLoad += loadTorque;
      const net = this.indicatedTorque - frictionTorque - loadTorque - fiTorque;
      this.omega = Math.max(this.running || this.cranking ? 20 : 0, this.omega + ((net + this.starterTorque(rpm)) / J) * dt);
    }
    this.crankDeg += ((this.omega * dt) / TWO_PI) * 360;
    if (this.crankDeg >= this.cycleDeg) this.crankDeg -= this.cycleDeg;
    this.torqueRipple = this.indicatedTorque;

    // ---- Duct arrivals
    const ducts = this.allDucts;
    for (let i = 0; i < ducts.length; i++) ducts[i].beginSample();

    // ---- Cylinders
    let torque = 0;
    const cyls = this.cylinders;
    const primaries = this.exhaust.primaries;
    const runners = this.intake.runners;
    const intakeT = this.intake.airTempK;
    const dilutionGain = 1;
    const plenumFraction = clamp(this.plenumBurned / Math.max(1e-6, this.plenumGasMass), 0, 0.8);
    for (let i = 0; i < cyls.length; i++) {
      const cyl = cyls[i];
      cyl.plenumBurnedFraction = plenumFraction;
      const alpha = this.modCycle(this.crankDeg - cyl.fireAngleDeg);
      const cmd = this.commandFor(i);
      cyl.step(alpha, this.omega, dt, this.exhaust.primaryPorts[i], this.intake.runnerPorts[i], intakeT, cmd, dilutionGain);
      // Exhaust-valve throat jet: broadband turbulence injected at the port while the jet is fast.
      let jetQ = 0;
      if (cyl.exhaustMassFlow > 0 && cyl.exhaustCdA > 0) {
        const rhoC = cyl.mass / cyl.volume;
        const cGas = Math.sqrt(1.34 * 287 * cyl.temperature);
        const u = Math.min(cGas, cyl.exhaustMassFlow / (rhoC * cyl.exhaustCdA));
        const mach = u / cGas;
        const jet = this.valveJets[i];
        if ((this.sampleIndex & 7) === 0) jet.setCentre((0.2 * u) / (this.spec.valves.exhaustDiameterMm / 1000));
        jetQ = jet.next() * (cyl.exhaustMassFlow / primaries[i].rho) * 0.06 * mach * mach * mach * this.stems.valveJet;
      }
      primaries[i].sendA = cyl.exhaustSend + primaries[i].Z * jetQ;
      runners[i].sendB = cyl.intakeSend;
      this.plenumBurned = Math.max(0, this.plenumBurned + cyl.spilledToPlenum - cyl.takenFromPlenum);
      torque += cyl.torque;
      this.pressureRates[i] = cyl.pressure - P_AMBIENT + cyl.knockPressure;
      if (cyl.knocked) this.telemetry.knockEvents++;
      if (cyl.exhaustMassFlow > 0) {
        this.exhaust.noteCylinderFlow(i, cyl.exhaustMassFlow, cyl.exhaustGasTemp);
        this.blockExhaustFlow += cyl.exhaustMassFlow;
        const g = this.exhaust.groupOf(i);
        this.exhaustFuel[g] += cyl.unburnedFuelOut;
        // Free oxygen leaving with the gas (lean or unfired cylinders pump air).
        const o2 = cyl.massAir / Math.max(1e-12, cyl.mass);
        this.exhaustOxygen[g] += (o2 - this.exhaustOxygen[g]) * Math.min(1, cyl.exhaustMassFlow * 0.02);
      }
      if (cyl.intakeClosed) this.structure.valveSeat(rpm, false);
      if (cyl.exhaustClosed) this.structure.valveSeat(rpm, true);
      if (!this.spec.rotary && alpha > 6 && alpha < 6 + (this.omega * dt * 360) / TWO_PI + 1e-9) this.structure.pistonSlap(cyl.pressure - P_AMBIENT, cyl.crankRadius / (this.spec.rodLengthMm / 1000));
    }
    this.indicatedTorque = torque;
    this.blockTorque += torque - frictionTorque;

    // ---- Afterfire in the collectors
    this.afterfire(dt);

    // ---- Forced induction, intake, exhaust networks
    if (this.fi) this.fi.step(dt, rpm, this.omega, this.controls.throttle);
    this.intake.step(this.throttlePlate(), this.bypassActual, dt);
    this.exhaust.step(dt);
    for (let i = 0; i < ducts.length; i++) ducts[i].commit();

    this.structure.starterRevPerSec = this.cranking ? this.omega / TWO_PI : 0;
    this.structure.step(this.pressureRates, 0.9, rpm);
    if (!render) return;

    // ---- Radiation to the listener
    let s = 0;
    for (const outlet of this.exhaust.outlets) {
      this.sourceQdot[s++] = outlet.volumeAcceleration * this.stems.exhaust + this.exhaust.outletJetNoise(outlet) * this.stems.exhaustJet;
    }
    this.sourceQdot[s++] = this.intake.mouthVolumeAcceleration * this.stems.intake;
    this.sourceQdot[s++] = this.structure.volumeAcceleration * this.stems.structure;
    if (this.fi) {
      const acc = this.fi.sourceVolumeAccelerations;
      for (let k = 0; k < acc.length; k++) this.sourceQdot[s++] = acc[k] * this.stems.accessory;
    }
    this.observer.process(this.sourceQdot, this.torqueRipple * this.stems.structure, this.ear);
    this.splAcc += this.ear[0] * this.ear[0];
    this.splN++;
  }

  private commandFor(i: number): CombustionCommand {
    const cut = this.sparkCuts[i] === 1;
    const lim = this.spec.calibration.revLimiter;
    const fuelEnabled = !this.fuelCut && !(this.limiterActive && lim === "hard-fuel-cut") && !(cut && lim === "soft");
    // Soft limiter: a cut cylinder loses spark as well as fuel, so the cut acts on the charge
    // already inducted instead of one cycle later. Every strategy keeps a hard ignition backstop on
    // instantaneous speed 150 rpm past the limiter (overspeed protection in production ECUs).
    const overspeed = this.rpm > this.spec.calibration.revLimiterRpm + 150 && this.running;
    const ignitionCut =
      overspeed ||
      (cut && lim === "soft") ||
      (this.limiterActive && (lim === "hard-ignition-cut" || this.launchHold !== null)) ||
      (this.controls.mode === "vehicle" && this.drivetrain.shiftCut);
    const live = this.running || this.cranking;
    const sparkEnabled = !ignitionCut && live;
    const cal = this.spec.calibration;
    // One reused command object: this runs per cylinder per sample, and cylinders never keep it.
    const c = this.command;
    c.sparkAdvanceDeg = this.sparkAdvance;
    c.lambda = this.lambdaTarget;
    c.fuelEnabled = fuelEnabled && live;
    c.sparkEnabled = sparkEnabled;
    c.fuelOctane = cal.fuelOctane;
    c.knockControl = cal.knockControl;
    if (this.spec.diesel) {
      // Compression ignition: the only lever is fuel; overspeed cuts injection.
      c.fuelEnabled = c.fuelEnabled && !overspeed;
      c.fuelMassKg = this.dieselFuel;
      c.injectionAdvanceDeg = this.injectionAdvance;
      c.smokeLambda = this.spec.diesel.smokeLambda;
    }
    return c;
  }

  private throttlePlate(): number {
    if (this.spec.diesel) return 1; // unthrottled: load is set by fuel quantity
    // Vehicle mode: the shift controller may blip the throttle to rev-match a downshift.
    const pedal = this.controls.mode === "vehicle" && this.drivetrain.blipThrottle !== null ? Math.max(this.controls.throttle, this.drivetrain.blipThrottle) : this.controls.throttle;
    // Drive-by-wire progression: small pedal → finer plate control at the bottom.
    return clamp(Math.pow(pedal, 1.35), 0, 1);
  }

  private frictionTorque(rpm: number): number {
    // Chen–Flynn mechanical FMEP: C + A·Pmax + B·Sp + Q·Sp² (bar, Sp mean piston speed in m/s).
    // plus a Stribeck boundary-lubrication term that lifts valvetrain/ring friction at low piston
    // speed. Calibrated to warm SI motoring data: ~1.05 bar at idle, ~1.2 bar at 2000 rpm, ~2.1 bar at 17 m/s.
    const sp = (2 * this.spec.strokeMm * 1e-3 * rpm) / 60;
    const pmax = Math.max(this.telemetry.peakPressureBar, 20);
    const fmep = (0.7 + 0.005 * pmax + 0.03 * sp + 0.0016 * sp * sp + 0.3 * Math.exp(-sp / 4)) * 1e5;
    const vd = this.displacementL / 1000;
    // Crankcase-scavenged two-strokes: no valvetrain, rolling-element main and big-end bearings
    // (≈ 35 % less mechanical friction than the four-stroke correlation).
    // Wankel: displacement here counts every face (1.5 × a four-stroke of equal airflow); no
    // valvetrain or reciprocating mass, but apex, side and corner seals rubbing at rotor tip speed
    // (≈ the four-stroke figure at equal airflow).
    const cycleFactor = this.spec.twoStroke ? 0.65 : this.spec.rotary ? 0.65 : 1;
    // Driven accessories (alternator, water/oil/fuel pumps, steering, A/C idle load) scale with the
    // engine they serve: ~16 N·m on a 6 L V8 at idle, ~3 N·m on a 1 L motorcycle engine.
    const accessory = (2.6 + 0.00035 * rpm) * this.displacementL;
    return (cycleFactor * fmep * vd) / (4 * Math.PI) + accessory;
  }

  /**
   * Phaser schedule in the shape production calibrations use: minimum overlap with the pedal closed
   * (idle and coast stability),
   * high overlap at part load (internal EGR, lower pumping work: intake advanced, exhaust retarded),
   * and at full load intake advance falling with speed (early IVC traps charge at low speed, late
   * IVC uses ram tuning at high speed). Hydraulic phasers slew at ~300 crank °/s. Lift switching
   * engages above its speed under load after an oil-pressure/locking-pin delay (~0.1 s), with
   * 300 rpm of hysteresis.
   */
  private scheduleValveTiming(rpm: number, pedal: number, mapKpa: number, blockSec: number): void {
    const cam = this.spec.cam;
    const cal = this.spec.calibration;
    const load = clamp((mapKpa - 25) / 70, 0, 1.5);
    // Closed pedal (idle, coast, decel) parks the phasers at minimum overlap.
    const idle = pedal < 0.03;
    const rpmN = rpm / cal.redlineRpm;
    const full = clamp((load - 0.6) / 0.3, 0, 1);
    const wotIntake = clamp(1 - (rpmN - 0.2) / 0.6, 0.15, 1);
    const intakeTarget = idle || this.fuelCut ? 0 : cam.intakePhaserDeg * (0.75 * (1 - full) + wotIntake * full);
    const exhaustTarget = idle || this.fuelCut ? 0 : cam.exhaustPhaserDeg * (0.8 * (1 - full) + 0.4 * full);
    const slew = 300 * blockSec;
    this.intakeCamAdvance += clamp(intakeTarget - this.intakeCamAdvance, -slew, slew);
    this.exhaustCamRetard += clamp(exhaustTarget - this.exhaustCamRetard, -slew, slew);
    if (cam.liftSwitch) {
      const want = this.highCamRequest
        ? rpm > cam.liftSwitch.switchRpm - 300 && load > 0.4
        : rpm > cam.liftSwitch.switchRpm && load > 0.6 && pedal > 0.5;
      this.highCamRequest = want;
      this.highCamTimer = want === this.highCam ? 0 : this.highCamTimer + blockSec;
      if (this.highCamTimer > 0.1) {
        this.highCam = want;
        this.highCamTimer = 0;
      }
    }
    if (!this.spec.twoStroke && !this.spec.rotary) for (const c of this.cylinders) c.setValveTiming(this.intakeCamAdvance, this.exhaustCamRetard, this.highCam, this.modCycle(this.crankDeg - c.fireAngleDeg));
    const t = this.telemetry;
    t.intakeCamAdvanceDeg = this.intakeCamAdvance;
    t.exhaustCamRetardDeg = this.exhaustCamRetard;
    t.highCam = this.highCam;
  }

  private externalLoadTorque(rpm: number): number {
    const c = this.controls;
    if (c.mode === "dyno") {
      // Absorber holds the set-point (it can also motor the engine, like an AC dyno).
      const err = this.omega - (c.targetRpm / 60) * TWO_PI;
      const J = this.spec.inertiaKgM2;
      this.absorberIntegral = clamp(this.absorberIntegral + err * J * 160 / this.sampleRate, -1500, 3000);
      return clamp(err * J * 60 + this.absorberIntegral, -600, 4000);
    }
    // Free running: road-load style torque that rises with speed, scaled by the load control.
    const ratedTorque = this.displacementL * 120 * (this.spec.forcedInduction.kind === "na" ? 1 : 1.6);
    return c.load * ratedTorque * (0.25 + 0.75 * Math.min(1, rpm / 4000));
  }

  private blockUpdate(): void {
    const cal = this.spec.calibration;
    const instantaneous = this.rpm;
    // ECU speed: segment timing over one firing interval (event-based tooth timing), which strips
    // the firing ripple without the lag of a multi-revolution average.
    const blockSecs = BLOCK / this.sampleRate;
    const tau = clamp((120 / Math.max(150, instantaneous)) / this.cylinders.length, 0.004, 0.12);
    this.ecuRpm += (instantaneous - this.ecuRpm) * (1 - Math.exp(-blockSecs / tau));
    const rpm = this.ecuRpm;
    const pedal = this.controls.throttle;
    const blockSec = BLOCK / this.sampleRate;

    // Start / stop: the engine catches once it accelerates past ~55 % of idle under its own power.
    if (this.cranking) {
      this.crankTime += blockSec;
      if (rpm > Math.max(400, 0.55 * cal.idleRpm) && this.crankTime > 0.25) {
        this.cranking = false;
        this.running = true;
        this.startFlare = 1;
        this.idleIntegral = this.idleFeedForward;
      } else if (this.crankTime > 5) this.cranking = false;
    }
    this.startFlare *= Math.exp(-blockSec / 1.5);
    this.telemetry.engineState = this.cranking ? "cranking" : this.running ? "running" : "off";

    // Idle air control: slow PI on speed around a feed-forward opening (production IAC behaviour);
    // the fast part of idle regulation is done with spark below.
    // Idle target with the post-start flare (production start calibration: ~+30 % decaying over ~1.5 s).
    const idleTarget = cal.idleRpm * (1 + 0.3 * this.startFlare);
    const idleErr = (idleTarget - rpm) / idleTarget;
    const rpmRate = (rpm - this.lastBlockRpm) / blockSec;
    this.lastBlockRpm = rpm;
    // Slow speed estimate (~0.3 s) for the adaptation gate: a loping cam's cycle-to-cycle swings
    // must not freeze the integrator, only a genuine fall from speed should.
    const prevSlow = this.slowRpm;
    this.slowRpm += (rpm - this.slowRpm) * (1 - Math.exp(-blockSec / 0.3));
    const slowRate = (this.slowRpm - prevSlow) / blockSec;
    if (pedal < 0.03) {
      // Integrate only near idle (anti-windup during the fall from high speed).
      const quasiSteady = Math.abs(slowRate) < cal.idleRpm * 0.6 && this.sinceLift > 1.2 && !this.fuelCut && this.running && !this.cranking && rpm > 0.5 * cal.idleRpm;
      if (this.controls.mode !== "dyno" && quasiSteady) this.idleIntegral = clamp(this.idleIntegral + idleErr * this.idleGains.ki * blockSec, this.idleFeedForward * 0.15, Math.min(1, this.idleFeedForward * 2.5));
      const damping = -(rpmRate / cal.idleRpm) * this.idleGains.kd;
      this.bypass = clamp(this.idleIntegral + idleErr * this.idleGains.kp + damping, this.idleFeedForward * 0.12, 1);
    } else {
      this.bypass = clamp(this.bypass + (this.idleIntegral + 0.12 - this.bypass) * 0.02, 0, 1);
    }
    // Decel dashpot: on lift-off the idle valve opens, then bleeds back over ~1 s so the engine lands
    // on idle instead of stalling or hanging.
    // (Carbureted two-strokes have neither: the slide's idle stop sets the closed-throttle airflow.)
    if (pedal < 0.03 && this.lastPedal >= 0.03 && !this.spec.twoStroke) this.dashpot = Math.min(1, this.idleFeedForward * 2.2);
    this.dashpot *= Math.exp(-blockSec / 1.2);
    this.sinceLift = pedal < 0.03 ? this.sinceLift + blockSec : 0;
    this.lastPedal = pedal;
    if (pedal < 0.03) this.bypass = Math.max(this.bypass, this.dashpot);
    // Decel airflow schedule: above idle with the pedal closed, production ECUs hold the idle valve
    // (or DBW plate) open enough for ~20 kPa MAP (oil control, emissions, smooth tip-in) instead of
    // letting the manifold pull a near-vacuum. Choked feed: area ∝ the engine's swept airflow at 20 kPa.
    if (pedal < 0.03 && rpm > cal.idleRpm + 300 && !this.spec.twoStroke) {
      const decelAir = 0.8 * (20_000 / (287.05 * 300)) * (this.displacementL / 1000) * (rpm / 60) * (360 / this.cycleDeg);
      const decelArea = decelAir / (0.78 * (P_AMBIENT / Math.sqrt(287.05 * 298)) * 0.685);
      const ramp = clamp((rpm - cal.idleRpm - 300) / 600, 0, 1);
      this.bypass = Math.max(this.bypass, ramp * clamp(decelArea / this.intake.bypassMaxArea, 0, 1));
    }
    // Idle valve / electronic throttle actuator: ~60 ms first-order response to the command.
    this.bypassActual += (this.bypass - this.bypassActual) * (1 - Math.exp(-blockSec / 0.06));


    // Decel fuel cut-off: armed only well above idle, resumes before idle (no hunting).
    if (cal.overrunFuelCut) {
      if (pedal < 0.02) this.overrunTimer += blockSec;
      else this.overrunTimer = 0;
      // Exit anticipates the speed 0.25 s ahead, so a fast-falling free-revving engine refuels in time.
      const predicted = rpm + rpmRate * 0.35;
      if (!this.fuelCut && this.overrunTimer > 0.25 && rpm > cal.idleRpm + 1100) {
        this.fuelCut = true;
        this.fuelCutAge = 0;
      } else if (this.fuelCut && (pedal > 0.03 || rpm < cal.idleRpm + 700 || predicted < cal.idleRpm + 900)) this.fuelCut = false;
      if (this.fuelCut) this.fuelCutAge += blockSec;
    }

    // Valved exhaust: opens above its speed, or early under heavy pedal (as sports calibrations do);
    // the flap actuator moves in ~0.25 s.
    const valve = this.spec.exhaust.valve;
    if (valve) {
      const mode = this.controls.exhaustValve ?? valve.mode;
      const target = mode === "open" ? 1 : mode === "closed" ? 0 : rpm > valve.openRpm || (pedal > 0.8 && rpm > 0.6 * valve.openRpm) ? 1 : 0;
      this.exhaustValvePos += clamp(target - this.exhaustValvePos, -blockSec / 0.25, blockSec / 0.25);
      this.exhaust.setValve(this.exhaustValvePos);
      this.telemetry.exhaustValve = this.exhaustValvePos;
    }

    // Valve timing: cam phasers and lift switching.
    this.scheduleValveTiming(rpm, pedal, this.intake.mapPa / 1000, blockSec);

    // Vehicle: shift controller and launch control.
    if (this.controls.mode === "vehicle") {
      const vc = { autoShift: this.controls.autoShift ?? true, launchControl: this.controls.launchControl ?? false, brake: this.controls.brake ?? 0 };
      this.drivetrain.control(blockSec, rpm, pedal, vc, this.telemetry.torqueNm - this.frictionTorque(rpm), this.spec.inertiaKgM2);
      this.launchHold = this.drivetrain.launchHoldRpm(vc);
      const d = this.drivetrain;
      const t = this.telemetry;
      t.gear = d.gear;
      t.speedKmh = d.speed * 3.6;
      t.clutch = d.clutch;
      t.shifting = d.phase !== "drive";
    } else this.launchHold = null;

    // Rev limiter (launch control: an ignition-cut hold at the launch speed — the source of launch bangs).
    const lim = this.launchHold ?? cal.revLimiterRpm;
    if (this.launchHold !== null) {
      if (!this.limiterActive && rpm > lim) this.limiterActive = true;
      else if (this.limiterActive && rpm < lim - 150) this.limiterActive = false;
      this.softCutFraction = 0;
    } else if (cal.revLimiter === "soft") {
      // Progressive cut, reaching every cylinder 130 rpm past the limiter (high-torque engines unloaded).
      this.softCutFraction = clamp((rpm - (lim - 30)) / 160, 0, 1);
      this.limiterActive = this.softCutFraction > 0;
      for (let i = 0; i < this.sparkCuts.length; i++) this.sparkCuts[i] = this.rng.next() < this.softCutFraction ? 1 : 0;
    } else {
      if (!this.limiterActive && rpm > lim) this.limiterActive = true;
      else if (this.limiterActive && rpm < lim - 180) this.limiterActive = false;
    }

    // Spark: MBT for the measured burn. Knock limits are found per cylinder by the end-gas
    // autoignition model and its knock controller (see Cylinder.integrateKnock), so compression,
    // boost, charge temperature, bore and fuel set the knock-limited advance physically.
    const map = this.intake.mapPa / 1000;
    // Closed-loop phasing: MBT from the burn duration each cylinder actually had last cycle.
    const c0 = this.cylinders[0];
    let duration = 0;
    for (const c of this.cylinders) duration += c.lastBurnDuration;
    duration /= this.cylinders.length;
    const mbt = mbtAdvance(duration);
    let advance = Math.min(mbt, 45);
    if (cal.revLimiter === "soft" && this.limiterActive) advance -= 12 * this.softCutFraction;
    // Idle: retarded base spark holds a torque reserve; spark moves fast to regulate speed.
    // Applies at every speed with the pedal closed, so coasting down onto idle is continuous
    // (no jump from retarded idle spark to MBT at some speed threshold).
    if (pedal < 0.03) advance = clamp(12 + idleErr * this.idleGains.spark - (rpmRate / cal.idleRpm) * this.idleGains.sparkD, 2, Math.min(advance, 28));
    if (this.cranking) advance = 5; // cranking spark: fixed near TDC
    this.sparkAdvance = clamp(advance, -5, 48);
    this.lambdaTarget = pedal > 0.75 || map > 92 ? cal.lambdaWot : rpm < cal.idleRpm * 1.3 ? 1 : cal.lambdaPart;
    if (this.spec.diesel) this.dieselGovernor(rpm, pedal, idleErr, rpmRate, blockSec);

    // Housekeeping at block rate.
    this.intake.updateBlock();
    this.plenumGasMass = (Math.max(0.3, this.spec.intake.plenumVolumeL) / 1000) * (this.intake.mapPa / (287.05 * this.intake.airTempK));
    const meanFlow = this.blockExhaustFlow / BLOCK;
    this.exhaust.updateBlock(blockSec, meanFlow, this.fi?.turbineInletK);
    if (this.fi) this.fi.updateBlock(blockSec);
    this.blockExhaustFlow = 0;

    // Telemetry (smoothed).
    const torque = this.blockTorque / BLOCK;
    this.blockTorque = 0;
    const t = this.telemetry;
    const a = 0.08;
    t.rpm = rpm;
    t.mapKpa += (map - t.mapKpa) * a;
    t.boostKpa = this.fi ? this.fi.boostKpa : 0;
    t.torqueNm += (torque - t.torqueNm) * 0.03;
    t.powerKw = (t.brakeTorqueNm * this.omega) / 1000;
    t.lambda = this.lambdaTarget;
    t.egtC = this.exhaust.portTemperatureK - 273;
    t.throttlePlate = this.throttlePlate();
    t.fuelCut = this.fuelCut;
    t.limiter = this.limiterActive;
    t.afterfire = this.afterfireCount;
    t.turboRpm = this.fi ? this.fi.shaftRpm : 0;
    let imep = 0;
    let ppk = 0;
    let lpp = 0;
    let trapped = 0;
    let retard = 0;
    for (const c of this.cylinders) {
      retard += c.knockRetard;
      imep += c.lastImep;
      ppk += c.lastPeakPressure;
      lpp += c.lastPeakAngle;
      trapped += c.lastTrappedAir;
    }
    const nc = this.cylinders.length;
    const s = 0.05;
    t.imepBar += (imep / nc / 1e5 - t.imepBar) * s;
    t.peakPressureBar += (ppk / nc / 1e5 - t.peakPressureBar) * s;
    t.peakPressureAngle += (lpp / nc - t.peakPressureAngle) * s;
    t.knockRetardDeg = retard / nc;
    const idealAir = (P_AMBIENT / (287.05 * 298.15)) * c0.sweptVolume;
    t.volumetricEfficiency += (trapped / nc / idealAir - t.volumetricEfficiency) * s;
    const load = this.blockLoad / BLOCK;
    this.blockLoad = 0;
    t.brakeTorqueNm += ((this.controls.mode === "dyno" ? load : torque) - t.brakeTorqueNm) * 0.02;
    if (this.splN > 2048) {
      t.splDb = 10 * Math.log10(this.splAcc / this.splN / 4e-10 + 1e-12);
      this.splAcc = 0;
      this.splN = 0;
    }
  }

  /**
   * All-speed diesel governor (block rate): fuel per cylinder per cycle from the pedal, an idle PI
   * on speed underneath it, and a droop to zero fuel across the last 180 rpm before the limiter
   * (diesels govern rather than cut). Start of injection advances with speed.
   */
  private dieselGovernor(rpm: number, pedal: number, idleErr: number, rpmRate: number, blockSec: number): void {
    const d = this.spec.diesel!;
    const cal = this.spec.calibration;
    // Torque-rise characteristic: full-load fuel per stroke tapers 12 % from 60 % of redline to
    // redline (pump torque plate / common-rail full-load map, turbine and EGT protection).
    const full = d.fullLoadFuelMg * 1e-6 * (1 - 0.12 * clamp((rpm - 0.6 * cal.redlineRpm) / (0.4 * cal.redlineRpm), 0, 1));
    if (this.dieselIdleFF === 0) {
      // Idle feed-forward from the energy balance: friction and accessories at ≈ 35 % indicated efficiency.
      const idleOmega = (cal.idleRpm / 60) * TWO_PI;
      const cyclesPerSec = (cal.idleRpm / 60) * (360 / this.cycleDeg) * this.cylinders.length;
      this.dieselIdleFF = (this.frictionTorque(cal.idleRpm) * idleOmega) / (0.35 * this.spec.fuelLhvMjKg * 1e6 * cyclesPerSec);
      this.dieselIdleIntegral = this.dieselIdleFF;
    }
    const ff = this.dieselIdleFF;
    const nearIdle = rpm < cal.idleRpm * 1.5 && this.running && !this.cranking;
    // PI only: the per-firing speed ripple of a diesel is large, and a derivative term turns it into
    // bang-bang fuelling.
    void rpmRate;
    if (nearIdle && this.controls.mode !== "dyno") this.dieselIdleIntegral = clamp(this.dieselIdleIntegral + idleErr * ff * 4 * blockSec, ff * 0.3, ff * 3);
    const idleFuel = clamp(this.dieselIdleIntegral + idleErr * ff * 4, 0, full);
    let fuel = Math.max(Math.pow(pedal, 1.15) * full, idleFuel);
    fuel *= clamp((cal.revLimiterRpm + 30 - rpm) / 180, 0, 1);
    if (this.cranking) fuel = 0.5 * full;
    this.dieselFuel = fuel;
    // Start of injection: retarded at idle (noise, NOx), advancing ≈ 1.5°/1000 rpm toward rated.
    const base = d.injectionAdvanceDeg;
    this.injectionAdvance = this.cranking ? 2 : clamp(base - 1.5 * ((cal.redlineRpm - rpm) / 1000), 1, base + 4);
    let trapped = 0;
    for (const c of this.cylinders) trapped += c.lastTrappedAir;
    trapped /= this.cylinders.length;
    this.lambdaTarget = fuel > 1e-9 ? Math.max(d.smokeLambda, trapped / (fuel * this.spec.fuelStoichAfr)) : 9.99;
  }

  private afterfire(dt: number): void {
    const tendency = this.spec.calibration.afterfireTendency;
    // Port-wall fuel film evaporating after the injectors stop (overrun / fuel-cut limiter): the
    // classic source of overrun crackle. Strength set by the calibration's afterfire tendency.
    // Interrupted combustion of any kind lets mixture reach the hot exhaust: fuel cut (port-wall
    // film), limiter or launch cuts, and ignition-cut flat shifts (unburned charge).
    const cutting = this.fuelCut || this.limiterActive || (this.controls.mode === "vehicle" && this.drivetrain.shiftCut);
    if (cutting && tendency > 0) {
      const perCycleFuel = (this.displacementL / 1000) * 1.1 / 14.7 / this.exhaustFuel.length;
      const film = tendency * 0.06 * perCycleFuel * (this.rpm / 120) * Math.exp(-this.fuelCutAge / 0.7) * dt;
      for (let g = 0; g < this.exhaustFuel.length; g++) this.exhaustFuel[g] += film;
    }
    for (let g = 0; g < this.exhaustFuel.length; g++) {
      // Unburned fuel flushes down the pipe (≈0.25 s residence).
      this.exhaustFuel[g] *= 1 - dt / 0.25;
      if (this.popRemaining[g] > 0) {
        // Expanding pocket displaces gas: equivalent mass injection at the local density.
        const rhoCollector = this.exhaust.collectors[g] ? this.exhaust.collectors[g].ports[0].duct.rho : 0.4;
        this.exhaust.collectorInjection[g] += this.popPulse[g] * rhoCollector * shape(this.popRemaining[g]);
        this.popRemaining[g] -= dt;
        continue;
      }
      const hot = clamp((this.exhaust.portTemperatureK - 820) / 250, 0, 1);
      const oxygen = clamp(this.exhaustOxygen[g] * 4, 0, 1);
      // While the engine fires, hot exhaust oxidises scavenged fuel and oxygen continuously
      // (afterburning, a few ms): no combustible pocket builds, so no detonation. Pops need
      // interrupted combustion (fuel cut, limiter cut, misfire streaks) to let mixture accumulate.
      if (!cutting) this.exhaustFuel[g] *= Math.exp(-hot * oxygen * 300 * dt);
      const fuel = this.exhaustFuel[g];
      if (fuel < 2e-7 || tendency <= 0) continue;
      const rate = tendency * 60 * hot * oxygen * Math.min(1, fuel / 2e-6) * (cutting ? 1 : 0.1);
      if (this.rng.next() < rate * dt) {
        const burned = fuel * (0.35 + 0.5 * this.rng.next());
        this.exhaustFuel[g] -= burned;
        // Isobaric expansion of the heated pocket: ΔV = E·(γ−1)/(γ·p)
        const energy = burned * this.spec.fuelLhvMjKg * 1e6 * 0.6;
        const deltaV = (energy * 0.34) / (1.34 * P_AMBIENT);
        const duration = 0.0035 + 0.003 * this.rng.next();
        this.popPulse[g] = deltaV / duration;
        this.popRemaining[g] = duration;
        this.afterfireCount++;
      }
    }

    function shape(remaining: number): number {
      // raised-cosine pocket expansion
      return 1;
    }
  }
}



function softLimit(x: number): number {
  const ax = Math.abs(x);
  if (ax <= 0.9) return x;
  const over = ax - 0.9;
  return Math.sign(x) * (0.9 + 0.1 * Math.tanh(over / 0.1));
}

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
import { displacementLitres } from "./spec";
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
import { createForcedInduction } from "./forcedInduction";
import type { ForcedInductionModel } from "./forcedInduction";

export type DriveMode = "free" | "dyno";

export interface EngineControls {
  /** Accelerator pedal 0..1. */
  throttle: number;
  /** External load 0..1 (free mode: road/brake load; ignored in dyno mode). */
  load: number;
  /** Dyno speed set-point, rpm. */
  targetRpm: number;
  mode: DriveMode;
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
  private bypassActual = 0.3;
  private fuelCut = false;
  private limiterActive = false;
  private softCutFraction = 0;
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
    fuelCut: false, limiter: false, afterfire: 0, turboRpm: 0, imepBar: 0, peakPressureBar: 0, peakPressureAngle: 0, brakeTorqueNm: 0, volumetricEfficiency: 0, knockRetardDeg: 0, knockEvents: 0, intakeCamAdvanceDeg: 0, exhaustCamRetardDeg: 0, highCam: false, splDb: 0,
  };

  constructor(spec: EngineSpec, sampleRate: number, options: SimulatorOptions = {}) {
    this.spec = spec;
    this.sampleRate = sampleRate;
    this.rng = new Rng(spec.seed * 2654435761);
    this.schedule = solveFiringSchedule(spec);
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
    };
    this.cylinders = this.schedule.cylinders.map((g) => new Cylinder(cylParams, g.fireAngleDeg, new Rng(spec.seed * 7919 + g.number * 104729)));
    // Fixed per-cylinder build offsets (the same engine always has the same "fingerprint").
    const tol = spec.calibration.buildTolerance;
    const build = new Rng(spec.seed * 31337 + 17);
    for (const c of this.cylinders) {
      c.flowScale = 1 + 0.03 * tol * clamp(build.gaussian(), -2.5, 2.5);
      c.burnScale = 1 + 0.05 * tol * clamp(build.gaussian(), -2.5, 2.5);
      c.fuelScale = 1 + 0.025 * tol * clamp(build.gaussian(), -2.5, 2.5);
    }
    this.intake = new IntakeSystem(spec, sampleRate, this.rng);
    this.exhaust = new ExhaustNetwork(spec, this.schedule, sampleRate, this.rng);
    this.fi = createForcedInduction(spec, sampleRate, this.rng, this.exhaust, this.intake);
    this.structure = new StructuralRadiator(sampleRate, this.displacementL, spec.cylinders, this.cylinders[0].area, this.rng, this.schedule.cylinders.map((c) => c.positionM));
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
    const cyclesPerSec = spec.calibration.idleRpm / 120;
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
    const idleArea = idleAir / (0.78 * (P_AMBIENT / Math.sqrt(287.05 * 298)) * 0.685);
    this.bypassAuthority = 1 + overlap / 25;
    this.intake.setBypassScale(this.bypassAuthority);
    this.idleFeedForward = clamp(idleArea / (spec.intake.idleBypassAreaMm2 * 1e-6 * this.bypassAuthority), 0.05, 0.9);
    // Burned-gas capacity of each runner: its gas mass at idle manifold density.
    const runnerVolume = (Math.PI / 4) * Math.pow(spec.intake.runnerDiameterMm / 1000, 2) * (spec.intake.runnerLengthMm / 1000);
    for (const cyl of this.cylinders) cyl.runnerResidualCapacity = runnerVolume * (this.idleMapTarget / (287.05 * 320));
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
    this.cylinders.forEach((cyl) => cyl.initialise(mod720(-cyl.fireAngleDeg), 60_000, 420));
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
    const loadTorque = this.externalLoadTorque(rpm);
    this.blockLoad += loadTorque;
    const fiTorque = this.fi ? this.fi.crankTorque : 0;
    const net = this.indicatedTorque - frictionTorque - loadTorque - fiTorque;
    this.omega = Math.max(20, this.omega + (net / J) * dt);
    this.crankDeg += ((this.omega * dt) / TWO_PI) * 360;
    if (this.crankDeg >= 720) this.crankDeg -= 720;
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
      const alpha = mod720(this.crankDeg - cyl.fireAngleDeg);
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
      if (alpha > 6 && alpha < 6 + (this.omega * dt * 360) / TWO_PI + 1e-9) this.structure.pistonSlap(cyl.pressure - P_AMBIENT, cyl.crankRadius / (this.spec.rodLengthMm / 1000));
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
    const sparkEnabled = !(this.limiterActive && lim === "hard-ignition-cut");
    const cal = this.spec.calibration;
    return { sparkAdvanceDeg: this.sparkAdvance, lambda: this.lambdaTarget, fuelEnabled, sparkEnabled, fuelOctane: cal.fuelOctane, knockControl: cal.knockControl };
  }

  private throttlePlate(): number {
    const pedal = this.controls.throttle;
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
    // Driven accessories (alternator, water/oil/fuel pumps, steering, A/C idle load) scale with the
    // engine they serve: ~16 N·m on a 6 L V8 at idle, ~3 N·m on a 1 L motorcycle engine.
    const accessory = (2.6 + 0.00035 * rpm) * this.displacementL;
    return (fmep * vd) / (4 * Math.PI) + accessory;
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
    for (const c of this.cylinders) c.setValveTiming(this.intakeCamAdvance, this.exhaustCamRetard, this.highCam, mod720(this.crankDeg - c.fireAngleDeg));
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

    // Idle air control: slow PI on speed around a feed-forward opening (production IAC behaviour);
    // the fast part of idle regulation is done with spark below.
    const idleErr = (cal.idleRpm - rpm) / cal.idleRpm;
    const rpmRate = (rpm - this.lastBlockRpm) / blockSec;
    this.lastBlockRpm = rpm;
    // Slow speed estimate (~0.3 s) for the adaptation gate: a loping cam's cycle-to-cycle swings
    // must not freeze the integrator, only a genuine fall from speed should.
    const prevSlow = this.slowRpm;
    this.slowRpm += (rpm - this.slowRpm) * (1 - Math.exp(-blockSec / 0.3));
    const slowRate = (this.slowRpm - prevSlow) / blockSec;
    if (pedal < 0.03) {
      // Integrate only near idle (anti-windup during the fall from high speed).
      const quasiSteady = Math.abs(slowRate) < cal.idleRpm * 0.6 && this.sinceLift > 1.2 && !this.fuelCut;
      if (this.controls.mode === "free" && quasiSteady) this.idleIntegral = clamp(this.idleIntegral + idleErr * this.idleGains.ki * blockSec, this.idleFeedForward * 0.15, Math.min(1, this.idleFeedForward * 2.5));
      const damping = -(rpmRate / cal.idleRpm) * this.idleGains.kd;
      this.bypass = clamp(this.idleIntegral + idleErr * this.idleGains.kp + damping, this.idleFeedForward * 0.12, 1);
    } else {
      this.bypass = clamp(this.bypass + (this.idleIntegral + 0.12 - this.bypass) * 0.02, 0, 1);
    }
    // Decel dashpot: on lift-off the idle valve opens, then bleeds back over ~1 s so the engine lands
    // on idle instead of stalling or hanging.
    if (pedal < 0.03 && this.lastPedal >= 0.03) this.dashpot = Math.min(1, this.idleFeedForward * 2.2);
    this.dashpot *= Math.exp(-blockSec / 1.2);
    this.sinceLift = pedal < 0.03 ? this.sinceLift + blockSec : 0;
    this.lastPedal = pedal;
    if (pedal < 0.03) this.bypass = Math.max(this.bypass, this.dashpot);
    // Decel airflow schedule: above idle with the pedal closed, production ECUs hold the idle valve
    // (or DBW plate) open enough for ~20 kPa MAP (oil control, emissions, smooth tip-in) instead of
    // letting the manifold pull a near-vacuum. Choked feed: area ∝ the engine's swept airflow at 20 kPa.
    if (pedal < 0.03 && rpm > cal.idleRpm + 300) {
      const decelAir = 0.8 * (20_000 / (287.05 * 300)) * (this.displacementL / 1000) * (rpm / 120);
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

    // Valve timing: cam phasers and lift switching.
    this.scheduleValveTiming(rpm, pedal, this.intake.mapPa / 1000, blockSec);

    // Rev limiter.
    const lim = cal.revLimiterRpm;
    if (cal.revLimiter === "soft") {
      this.softCutFraction = clamp((rpm - (lim - 30)) / 160, 0, 0.85);
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
    this.sparkAdvance = clamp(advance, -5, 48);
    this.lambdaTarget = pedal > 0.75 || map > 92 ? cal.lambdaWot : rpm < cal.idleRpm * 1.3 ? 1 : cal.lambdaPart;

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

  private afterfire(dt: number): void {
    const tendency = this.spec.calibration.afterfireTendency;
    // Port-wall fuel film evaporating after the injectors stop (overrun / fuel-cut limiter): the
    // classic source of overrun crackle. Strength set by the calibration's afterfire tendency.
    const cutting = this.fuelCut || (this.limiterActive && this.spec.calibration.revLimiter === "hard-fuel-cut");
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

function mod720(x: number): number {
  const r = x % 720;
  return r < 0 ? r + 720 : r;
}

function softLimit(x: number): number {
  const ax = Math.abs(x);
  if (ax <= 0.9) return x;
  const over = ax - 0.9;
  return Math.sign(x) * (0.9 + 0.1 * Math.tanh(over / 0.1));
}

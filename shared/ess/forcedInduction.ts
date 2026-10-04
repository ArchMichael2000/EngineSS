/**
 * Forced induction as coupled subsystems.
 *
 * Turbocharger: turbine power from the exhaust stages compiled in ExhaustNetwork
 * (the turbine orifice and manifold volume also damp the blowdown pulses — the
 * physical reason turbo engines sound muffled), a rotor ODE, and a centrifugal
 * compressor with a Moore–Greitzer cubic characteristic and duct inertia
 * feeding a charge (intercooler) volume. Closing the throttle without a BOV
 * walks the compressor left of its peak and the Greitzer dynamics surge on
 * their own ("flutter"). Wastegate PI holds boost; the BOV vents above a
 * pressure differential.
 *
 * Superchargers: Roots / twin-screw deliver displacement flow (with leakage)
 * whose pocket discharge pulsation and timing-gear mesh are the whine;
 * centrifugal superchargers reuse the compressor model on a crank-driven shaft
 * with a step-up gear whose mesh tone dominates.
 *
 * Acoustic outputs are monopole volume accelerations at the compressor inlet,
 * BOV and blower case, plus waves injected into the exhaust downpipe.
 */
import type { EngineSpec, SuperchargerSpec, TurboSpec } from "./spec";
import { BandNoise, CP_AIR, CP_GAS, GAMMA_AIR, GAMMA_GAS, P_AMBIENT, R_AIR, RHO_AIR, Rng, T_AMBIENT, clamp, orificeMassFlow } from "./gas";
import type { ExhaustNetwork } from "./exhaust";
import type { IntakeSystem } from "./intake";
import type { SourceDef } from "./observer";
import type { Duct } from "./waveguide";
import { send } from "./waveguide";

export interface ForcedInductionModel {
  step(dt: number, rpm: number, crankOmega: number, pedal: number): void;
  updateBlock(blockSeconds: number): void;
  readonly sourceDefs: SourceDef[];
  readonly sourceVolumeAccelerations: Float64Array;
  readonly boostKpa: number;
  readonly shaftRpm: number;
  /** Torque the device takes from the crank (supercharger drive), N·m. */
  readonly crankTorque: number;
  readonly turbineInletK: number | undefined;
  ducts(): Duct[];
}

export function createForcedInduction(spec: EngineSpec, fs: number, rng: Rng, exhaust: ExhaustNetwork, intake: IntakeSystem): ForcedInductionModel | null {
  const fi = spec.forcedInduction;
  if (fi.kind === "turbo") return new Turbocharger(spec, fi, fs, rng, exhaust, intake);
  if (fi.kind === "supercharger") return new Supercharger(spec, fi, fs, rng, intake);
  return null;
}

const COMPRESSOR_INLET = { x: 0.45, y: 1.75, z: 0.6 };
const BOV_POSITION = { x: 0.3, y: 2.0, z: 0.55 };
const BLOWER_POSITION = { x: 0, y: 1.5, z: 0.85 };

/**
 * Centrifugal compressor stage. Speed line in non-dimensional form, ψ = Δp/(ρ1U²) against
 * φ = ṁ/(ρ1·U·D²) (tip speed U, wheel diameter D): positive slope left of the peak (the
 * Greitzer-unstable region where surge lives), parabolic fall to choke, rising backflow branch
 * for reversed flow. Duct inertia L/A integrates the flow, so surge emerges dynamically.
 */
class Compressor {
  readonly tipRadius: number;
  readonly diameter: number;
  massFlow = 0.01;
  pressureRatio = 1;
  power = 0;
  efficiency = 0.7;
  /** Duct inertance L/A, 1/m. */
  private readonly inertance: number;
  private readonly psiMax = 0.56;
  private readonly psiShutoff = 0.42;
  // Exducer-based flow coefficient of modern (ported-shroud) automotive stages: surge-side peak
  // ≈ 0.04, peak efficiency ≈ 0.09, choke ≈ 0.165.
  private readonly phiPeak = 0.04;
  private readonly phiChoke = 0.165;
  private readonly phiDesign = 0.09;

  constructor(wheelDiameterM: number) {
    this.diameter = wheelDiameterM;
    this.tipRadius = wheelDiameterM / 2;
    // Greitzer duct: the air column that oscillates in surge runs from the inlet through the
    // compressor and the charge piping/intercooler to the throttle, ≈ 1.8 m on a car. With the
    // charge volume this puts the Helmholtz (mild surge) frequency near 20–35 Hz and deep surge at
    // 50–90 % of that (Dehner & Selamet, OSU turbocharger surge rig).
    const inducerArea = Math.PI * Math.pow(wheelDiameterM * 0.36, 2);
    this.inertance = 1.8 / inducerArea;
  }

  phi(massFlow: number, tipSpeed: number, rho1: number): number {
    return massFlow / (rho1 * Math.max(5, tipSpeed) * this.diameter * this.diameter);
  }

  characteristic(massFlow: number, tipSpeed: number, rho1: number): number {
    const phi = this.phi(massFlow, tipSpeed, rho1);
    let psi: number;
    // Backflow branch rises with |φ| (Greitzer): driving air backwards through the spinning wheel
    // takes more than shut-off head, so a surge cycle's reversed flow decelerates and recovers.
    if (phi < 0) psi = this.psiShutoff + 25 * phi * phi;
    else if (phi < this.phiPeak) {
      const u = (this.phiPeak - phi) / this.phiPeak;
      psi = this.psiMax - (this.psiMax - this.psiShutoff) * u * u;
    } else {
      const u = (phi - this.phiPeak) / (this.phiChoke - this.phiPeak);
      psi = this.psiMax * (1 - u * u);
    }
    return rho1 * tipSpeed * tipSpeed * psi;
  }

  step(dt: number, tipSpeed: number, p1: number, t1: number, p2: number): void {
    const rho1 = p1 / (R_AIR * t1);
    const rise = this.characteristic(this.massFlow, tipSpeed, rho1);
    this.massFlow += ((rise - (p2 - p1)) / this.inertance) * dt;
    this.massFlow = clamp(this.massFlow, -0.8, 3);
    this.pressureRatio = Math.max(0.5, p2 / p1);
    const phi = this.phi(this.massFlow, tipSpeed, rho1);
    // Efficiency island: ~0.78 at design, ~0.68 along the surge line, falling into choke.
    this.efficiency = clamp(0.78 - 25 * Math.pow(phi - this.phiDesign, 2) - 0.08 * clamp((this.phiPeak - phi) / this.phiPeak, 0, 1), 0.3, 0.78);
    const work = CP_AIR * t1 * (Math.pow(Math.max(1, this.pressureRatio), (GAMMA_AIR - 1) / GAMMA_AIR) - 1);
    // Windage/disk friction keeps the wheel loaded even at zero flow (∝ ρU³D²).
    const windage = 0.004 * rho1 * Math.pow(Math.max(0, tipSpeed), 3) * this.diameter * this.diameter;
    this.power = (Math.max(0, this.massFlow) * work) / this.efficiency + windage;
  }

  outletTemperature(t1: number): number {
    return t1 * (1 + (Math.pow(Math.max(1, this.pressureRatio), (GAMMA_AIR - 1) / GAMMA_AIR) - 1) / this.efficiency);
  }

  /** Off-design incidence 0 (design) … 1+ (near surge or choke) for whoosh/flow noise. */
  offDesign(tipSpeed: number, p1: number, t1: number): number {
    const phi = this.phi(this.massFlow, tipSpeed, p1 / (R_AIR * t1));
    return Math.abs(phi - this.phiDesign) / this.phiDesign;
  }
}

/** Charge (compressor outlet + intercooler) volume between compressor and throttle. */
class ChargeVolume {
  pressure = P_AMBIENT;
  temperature = T_AMBIENT + 10;
  constructor(readonly volumeM3: number) {}
  step(dt: number, massIn: number, inTempK: number, massOut: number, intercooler: number): void {
    const tIn = inTempK - intercooler * (inTempK - (T_AMBIENT + 8));
    const dp = ((GAMMA_AIR * R_AIR) / this.volumeM3) * (massIn * tIn - massOut * this.temperature) * dt;
    this.pressure = clamp(this.pressure + dp, 0.3 * P_AMBIENT, 4.5 * P_AMBIENT);
    this.temperature += (tIn - this.temperature) * Math.min(1, (Math.abs(massIn) * dt * R_AIR * this.temperature) / (this.pressure * this.volumeM3));
  }
}

class Turbocharger implements ForcedInductionModel {
  readonly sourceDefs: SourceDef[] = [
    { kind: "accessory", position: COMPRESSOR_INLET },
    { kind: "accessory", position: BOV_POSITION },
  ];
  readonly sourceVolumeAccelerations = new Float64Array(2);
  crankTorque = 0;
  turbineInletK: number | undefined = undefined;
  private omega = 2500;
  private readonly compressor: Compressor;
  private readonly charge: ChargeVolume;
  private readonly maxOmega: number;
  private bladePhase = 0;
  private shaftPhase = 0;
  private turbinePhase = 0;
  private readonly whoosh: BandNoise;
  private readonly tipNoise: BandNoise;
  private readonly bovNoise: BandNoise;
  private readonly wgNoise: BandNoise;
  private wastegateIntegral = 0;
  private prevChargePa = P_AMBIENT;
  private boostRate = 0;
  private bovOpen = 0;
  private bovFlow = 0;
  private prevCompressorQ = 0;
  private prevBovQ = 0;
  private readonly targetPa: number;
  /** Blow-off valve flow area (all turbos), m². */
  private readonly bovArea: number;

  constructor(private readonly spec: EngineSpec, private readonly t: TurboSpec, private readonly fs: number, rng: Rng, private readonly exhaust: ExhaustNetwork, private readonly intake: IntakeSystem) {
    this.compressor = new Compressor(t.compressorWheelDiameterMm / 1000);
    this.charge = new ChargeVolume(t.chargeVolumeL / 1000);
    // Tip speed limit ~520 m/s for cast aluminium wheels.
    this.maxOmega = 520 / this.compressor.tipRadius;
    this.targetPa = P_AMBIENT + t.targetBoostKpa * 1000;
    this.bovArea = 0.16 * this.compressor.diameter * this.compressor.diameter * Math.max(1, t.count);
    this.whoosh = new BandNoise(rng, fs, 0.45);
    this.tipNoise = new BandNoise(rng, fs, 6);
    this.bovNoise = new BandNoise(rng, fs, 0.5);
    this.wgNoise = new BandNoise(rng, fs, 0.5);
    this.intake.upstreamPa = this.charge.pressure;
  }

  get boostKpa(): number {
    return (this.charge.pressure - P_AMBIENT) / 1000;
  }

  get shaftRpm(): number {
    return (this.omega * 60) / (2 * Math.PI);
  }

  ducts(): Duct[] {
    return [];
  }

  step(dt: number, _rpm: number, _crankOmega: number, _pedal: number): void {
    const stages = this.exhaust.turbines;
    // Turbine power (expansion of the non-bypassed flow), η_t ≈ 0.68.
    let turbinePower = 0;
    for (const s of stages) {
      const throughTurbine = Math.max(0, s.massFlow - s.wastegateMassFlow);
      const pr = clamp(s.outletPa / Math.max(1, s.inletPa), 0.2, 1);
      turbinePower += 0.68 * throughTurbine * CP_GAS * s.inletK * (1 - Math.pow(pr, (GAMMA_GAS - 1) / GAMMA_GAS));
    }
    const p1 = this.intake.compressorInletPa;
    const t1 = T_AMBIENT;
    const tip = this.omega * this.compressor.tipRadius;
    this.compressor.step(dt, tip, p1, t1, this.charge.pressure);
    // `count` identical turbos in parallel: one modelled rotor, flows and powers scaled by count.
    const n = Math.max(1, this.t.count);
    const J = this.t.rotorInertiaKgM2 / n;
    const bearing = 2.5e-7 * this.omega * this.omega;
    const torque = (turbinePower / n - this.compressor.power - bearing) / Math.max(200, this.omega);
    this.omega = clamp(this.omega + (torque / J) * dt, 500, this.maxOmega * 1.05);

    // BOV: a spring-loaded piston with charge pressure underneath and manifold pressure on top, so it
    // opens on the pressure difference across the throttle (no pedal input): cracking at 20 kPa, fully
    // open at 40 kPa, ≈ 12 ms piston travel. Valve sized to the compressor (≈ 0.45 × wheel
    // diameter: 22 mm on a 50 mm wheel, 38 mm on an 83 mm one) so it can pass the wheel's flow at
    // low pressure ratio and the charge vents in a few hundred milliseconds.
    const dpThrottle = this.charge.pressure - this.intake.mapPa;
    const bovTarget = this.t.blowOffValve ? clamp((dpThrottle - 20_000) / 20_000, 0, 1) : 0;
    this.bovOpen += (bovTarget - this.bovOpen) * Math.min(1, dt / 0.012);
    this.bovFlow = this.t.blowOffValve ? orificeMassFlow(this.bovOpen * this.bovArea, this.charge.pressure, this.charge.temperature, P_AMBIENT, T_AMBIENT) : 0;

    const throttleFlow = this.intake.throttleMassFlow;
    this.charge.step(dt, n * this.compressor.massFlow, this.compressor.outletTemperature(t1), throttleFlow + this.bovFlow, 0.72);
    this.intake.upstreamPa = this.charge.pressure;
    this.intake.upstreamK = this.charge.temperature;
    this.intake.compressorDraw = n * this.compressor.massFlow;

    // ---- Acoustics
    const shaftHz = this.omega / (2 * Math.PI);
    const blades = this.t.compressorBlades;
    const bpf = shaftHz * blades;
    const nyq = this.fs * 0.45;
    this.bladePhase += (2 * Math.PI * bpf) / this.fs;
    this.shaftPhase += (2 * Math.PI * shaftHz) / this.fs;
    this.turbinePhase += (2 * Math.PI * shaftHz * this.t.turbineBlades) / this.fs;
    if (this.bladePhase > 1e4) this.bladePhase %= 2 * Math.PI;
    if (this.shaftPhase > 1e4) this.shaftPhase %= 2 * Math.PI;
    if (this.turbinePhase > 1e4) this.turbinePhase %= 2 * Math.PI;
    const flow = Math.max(0, this.compressor.massFlow);
    const qFlow = flow / RHO_AIR;
    const loading = clamp((this.compressor.pressureRatio - 1) / 1.2, 0, 1.5);
    const tipMach = tip / 340;
    // Blade-passing tone and its rotor-locked buzz (inlet-radiated), gated below Nyquist.
    const bpfGain = bpf < nyq ? (1 - clamp((bpf - 0.38 * this.fs) / (0.07 * this.fs), 0, 1)) : 0;
    const tone = Math.sin(this.bladePhase) * bpfGain * qFlow * 0.9 * tipMach * tipMach * (0.4 + loading);
    const shaftTone = Math.sin(this.shaftPhase) * qFlow * 0.05 * tipMach;
    // Tip-clearance noise: narrowband around half BPF.
    this.tipNoise.setCentre(Math.min(bpf * 0.5, nyq));
    const tipBand = this.tipNoise.next() * qFlow * 0.25 * tipMach * tipMach * loading;
    // Whoosh: broadband flow noise rising off-design (incidence) and with flow.
    this.whoosh.setCentre(clamp(0.6 * bpf * 0.12 + 1500, 800, 7000));
    const offDesign = this.compressor.offDesign(tip, p1, t1);
    const whoosh = this.whoosh.next() * qFlow * (0.25 + 2.2 * offDesign) * tipMach * tipMach;
    // Surge: the oscillating compressor flow itself radiates from the inlet.
    const qComp = this.compressor.massFlow / RHO_AIR;
    const surgeQdot = (qComp - this.prevCompressorQ) * this.fs;
    this.prevCompressorQ = qComp;
    // Parallel turbos are incoherent sources (slightly different shaft speeds): power adds, √n in amplitude.
    this.sourceVolumeAccelerations[0] = ((tone + shaftTone + tipBand + whoosh) * 2 * Math.PI * Math.max(400, bpf * 0.5) * 0.02 + surgeQdot * 0.6) * Math.sqrt(n);

    // BOV vent jet.
    const qBov = this.bovFlow / RHO_AIR;
    const uBov = qBov / Math.max(1e-5, this.bovOpen * this.bovArea);
    this.bovNoise.setCentre(clamp((0.2 * Math.max(5, uBov)) / Math.sqrt(this.bovArea), 200, 9000));
    const bovQdot = (qBov - this.prevBovQ) * this.fs;
    this.prevBovQ = qBov;
    this.sourceVolumeAccelerations[1] = this.bovNoise.next() * qBov * Math.min(1, Math.pow(uBov / 340, 2)) * 4000 + bovQdot * 0.2;

    // Turbine-side: blade-passing tone and wastegate turbulence injected into each downpipe.
    for (const s of stages) {
      const down = s.downpipe;
      const tbpf = shaftHz * this.t.turbineBlades;
      const tGain = tbpf < nyq ? 1 : 0;
      const qT = s.massFlow / down.rho;
      this.wgNoise.setCentre(clamp(1800 + 4000 * s.wastegate, 500, 9000));
      const wg = this.wgNoise.next() * (s.wastegateMassFlow / down.rho) * 0.15;
      const turb = Math.sin(this.turbinePhase) * qT * 0.012 * tGain;
      down.sendA += down.Z * (wg + turb);
    }
  }

  updateBlock(blockSeconds: number): void {
    // Wastegate: PI on boost, pressure-referenced (spring + duty).
    const err = (this.charge.pressure - this.targetPa) / this.targetPa;
    this.wastegateIntegral = clamp(this.wastegateIntegral + err * 6 * blockSeconds, 0, 1);
    // Anticipation: the proportional term acts on boost predicted 0.15 s ahead from its rise rate
    // (filtered), as production boost controllers do, which holds tip-in overshoot near 10 % (17 % without it).
    const rate = (this.charge.pressure - this.prevChargePa) / Math.max(1e-4, blockSeconds);
    this.prevChargePa = this.charge.pressure;
    this.boostRate += (rate - this.boostRate) * Math.min(1, blockSeconds / 0.03);
    const predicted = (this.charge.pressure + Math.max(0, this.boostRate) * 0.15 - this.targetPa) / this.targetPa;
    // Turbo-speed protection: the wastegate also opens as the shaft nears its tip-speed limit, so a
    // compressor that can't quite reach target boost doesn't drive turbine inlet pressure away.
    const overspeed = clamp((this.omega / this.maxOmega - 0.94) / 0.06, 0, 1);
    const duty = this.t.wastegate ? clamp(Math.max(this.wastegateIntegral + Math.max(err, predicted) * 8, overspeed), 0, 1) : 0;
    for (const s of this.exhaust.turbines) s.wastegate = duty;
    let tIn = 0;
    for (const s of this.exhaust.turbines) tIn = Math.max(tIn, s.inletK);
    this.turbineInletK = undefined;
  }
}

class Supercharger implements ForcedInductionModel {
  readonly sourceDefs: SourceDef[] = [{ kind: "accessory", position: BLOWER_POSITION }];
  readonly sourceVolumeAccelerations = new Float64Array(1);
  crankTorque = 0;
  readonly turbineInletK = undefined;
  private readonly charge: ChargeVolume;
  private readonly compressor: Compressor | null;
  private rotorPhase = 0;
  private gearPhase = 0;
  private stepUpPhase = 0;
  private rotorOmega = 0;
  private bypass = 0;
  private readonly flowNoise: BandNoise;
  private prevQ = 0;
  private shaftRpmValue = 0;

  constructor(private readonly spec: EngineSpec, private readonly s: SuperchargerSpec, private readonly fs: number, rng: Rng, private readonly intake: IntakeSystem) {
    this.charge = new ChargeVolume(Math.max(1.2, spec.intake.plenumVolumeL * 0.6) / 1000);
    this.compressor = s.type === "centrifugal" ? new Compressor(s.impellerDiameterMm / 1000) : null;
    this.flowNoise = new BandNoise(rng, fs, 0.5);
  }

  get boostKpa(): number {
    return (this.charge.pressure - P_AMBIENT) / 1000;
  }

  get shaftRpm(): number {
    return this.shaftRpmValue;
  }

  ducts(): Duct[] {
    return [];
  }

  step(dt: number, rpm: number, crankOmega: number, pedal: number): void {
    const s = this.s;
    const p1 = this.intake.compressorInletPa;
    const t1 = T_AMBIENT;
    const rho1 = p1 / (R_AIR * t1);
    // Bypass valve recirculates at part throttle (manifold vacuum opens it).
    const bypassTarget = s.bypassValve ? clamp((0.55 - pedal) / 0.35, 0, 1) : 0;
    this.bypass += (bypassTarget - this.bypass) * Math.min(1, dt / 0.08);
    const outletPa = this.charge.pressure;
    let delivered: number;
    let outletK: number;
    let shaftPower: number;
    if (this.compressor) {
      this.rotorOmega = crankOmega * s.driveRatio * s.stepUpRatio;
      const tip = this.rotorOmega * this.compressor.tipRadius;
      this.compressor.step(dt, tip, p1, t1, outletPa);
      delivered = this.compressor.massFlow;
      outletK = this.compressor.outletTemperature(t1);
      shaftPower = this.compressor.power / 0.93;
    } else {
      this.rotorOmega = crankOmega * s.driveRatio;
      const rotorRevPerSec = this.rotorOmega / (2 * Math.PI);
      const dp = Math.max(0, outletPa - p1);
      // Leakage past rotor tips falls with speed (Eaton/Lysholm map shape).
      const leakage = clamp((0.06 * Math.sqrt(dp / 1000)) / Math.max(0.5, rotorRevPerSec / 60), 0, 0.6);
      const volumetric = (1 - leakage) * (s.type === "twin-screw" ? 0.95 : 0.92);
      delivered = rho1 * (s.displacementL / 1000) * rotorRevPerSec * volumetric;
      const pr = Math.max(1, outletPa / p1);
      // Roots: no internal compression → work = Q·Δp (adiabatic efficiency falls with PR).
      const ideal = CP_AIR * t1 * (Math.pow(pr, (GAMMA_AIR - 1) / GAMMA_AIR) - 1);
      const eta = s.type === "twin-screw" ? 0.7 : clamp(0.62 - 0.25 * (pr - 1.3), 0.4, 0.62);
      outletK = t1 + ideal / (CP_AIR * eta);
      shaftPower = (delivered * ideal) / eta;
    }
    // Bypass valve joins blower outlet to inlet: flow either way through a ~50 mm butterfly, so an open
    // bypass equalises the charge volume with the inlet (and unloads the blower).
    const bypassFlow = orificeMassFlow(this.bypass * 1.9e-3 * 0.7, p1, t1, outletPa, this.charge.temperature);
    shaftPower *= 1 - 0.85 * this.bypass;
    this.crankTorque = shaftPower / Math.max(30, crankOmega);
    this.charge.step(dt, delivered + bypassFlow, outletK, this.intake.throttleMassFlow, s.type === "centrifugal" ? 0.7 : 0.6);
    // Boost relief: the bypass caps manifold pressure at the target.
    const relief = Math.max(0, this.charge.pressure - (P_AMBIENT + s.targetBoostKpa * 1000) * 1.06);
    if (relief > 0) this.charge.pressure -= relief * Math.min(1, dt * 40);
    this.intake.upstreamPa = this.charge.pressure;
    this.intake.upstreamK = this.charge.temperature;
    this.intake.compressorDraw = delivered;
    this.shaftRpmValue = (this.rotorOmega * 60) / (2 * Math.PI);

    // ---- Acoustics (blower case + outlet pulsation)
    const nyq = this.fs * 0.45;
    const rotorHz = this.rotorOmega / (2 * Math.PI);
    const loadFactor = clamp((outletPa - p1) / 60_000, 0, 2) * (1 - 0.7 * this.bypass);
    const intensity = s.whineIntensity;
    let qdot = 0;
    if (s.type === "centrifugal") {
      const pulleyHz = (crankOmega * s.driveRatio) / (2 * Math.PI);
      const meshHz = pulleyHz * s.timingGearTeeth;
      this.stepUpPhase += (2 * Math.PI * Math.min(meshHz, nyq)) / this.fs;
      this.rotorPhase += (2 * Math.PI * Math.min(rotorHz * s.impellerBlades, nyq)) / this.fs;
      const meshGain = meshHz < nyq ? 1 : 0;
      const bladeGain = rotorHz * s.impellerBlades < nyq ? 1 : 0;
      const q = Math.max(0, delivered) / RHO_AIR;
      // Straight-cut step-up gear mesh is the signature centrifugal whine; amplitude with transmitted torque.
      qdot += Math.sin(this.stepUpPhase) * meshGain * (0.002 + 0.02 * loadFactor) * Math.min(1, meshHz / 2000) * 60;
      qdot += Math.sin(this.rotorPhase) * bladeGain * q * 0.6 * Math.pow(rotorHz / 1500, 2);
      this.flowNoise.setCentre(2500);
      qdot += this.flowNoise.next() * q * 30;
    } else {
      const pocketsPerRev = s.type === "twin-screw" ? s.lobes : s.lobes * 2;
      const pocketHz = rotorHz * pocketsPerRev;
      this.rotorPhase += (2 * Math.PI * pocketHz) / this.fs;
      this.gearPhase += (2 * Math.PI * rotorHz * s.timingGearTeeth) / this.fs;
      if (this.rotorPhase > 1e4) this.rotorPhase %= 2 * Math.PI;
      if (this.gearPhase > 1e4) this.gearPhase %= 2 * Math.PI;
      // Pocket discharge: backflow spike when a pocket at inlet pressure opens to boost. Helix twist
      // spreads the opening over twist/360 of a pocket period → smoother pulse, fewer harmonics.
      const phase = (this.rotorPhase / (2 * Math.PI)) % 1;
      const spread = clamp(s.helixTwistDeg / 360, 0.05, 0.9);
      const pulse = Math.exp(-phase / (0.06 + 0.25 * spread)) - (0.06 + 0.25 * spread);
      const backflowStrength = s.type === "twin-screw" ? 0.35 : 1;
      const q = Math.max(0, delivered) / RHO_AIR;
      const pulseQ = q * pulse * backflowStrength * loadFactor * 0.6;
      const pulseQdot = (pulseQ - this.prevQ) * this.fs;
      this.prevQ = pulseQ;
      const meshHz = rotorHz * s.timingGearTeeth;
      const mesh = meshHz < nyq ? Math.sin(this.gearPhase) * (0.4 + loadFactor) * Math.min(1, meshHz / 3000) * 2.5 : 0;
      qdot += (pulseQdot * 0.05 + mesh) * intensity * 1.6;
      this.flowNoise.setCentre(clamp(pocketHz * 3, 400, 8000));
      qdot += this.flowNoise.next() * q * 25 * (0.3 + loadFactor);
    }
    this.sourceVolumeAccelerations[0] = qdot * intensity;
  }

  updateBlock(): void {
    /* no block-rate control */
  }
}

/**
 * Zero-dimensional cylinder: slider-crank kinematics, harmonic cam lobes,
 * implicit compressible valve flow against the attached duct impedance,
 * Wiebe heat release with physically conditioned cycle-to-cycle variation,
 * Woschni wall heat transfer and charge composition (fresh air, fuel, burned).
 *
 * The cylinder never synthesises sound. The exhaust and intake waves are the
 * pressure and volume velocity its valve flows impose on the ducts.
 */
import type { CamSpec } from "./spec";
import { CP_GAS, CV_GAS, GAMMA_GAS, P_AMBIENT, PowTable, R_AIR, Rng, clamp, lerpTable, orificeMassFlow, waveExponents } from "./gas";
import type { Port } from "./waveguide";
import { arriving } from "./waveguide";

const DEG = Math.PI / 180;
const THOU_050_M = 0.00127;

/** Harmonic cam lobe (engine-sim's generator): lift = L·(½ + ½cos kx)^γ, calibrated by duration at 0.050". */
export class CamLobe {
  private readonly k: number;
  private readonly extent: number;
  /** Lift tabulated every 0.25 crank degree over the open period (no pow() in the audio loop). */
  private readonly table: Float64Array;
  private readonly halfOpenDeg: number;
  /** Phaser shift of the centreline, crank degrees (negative = earlier). */
  phaseDeg = 0;
  constructor(readonly centreDeg: number, durationAt050Deg: number, readonly liftM: number, readonly gamma: number) {
    const halfCam = (durationAt050Deg / 4) * DEG;
    const s = Math.pow((2 * THOU_050_M) / Math.max(liftM, THOU_050_M * 2.2), 1 / gamma) - 1;
    this.k = Math.acos(clamp(s, -1, 1)) / halfCam;
    this.extent = Math.PI / this.k;
    this.halfOpenDeg = (this.extent / DEG) * 2;
    const steps = Math.ceil(this.halfOpenDeg * 4) + 2;
    this.table = new Float64Array(steps + 1);
    for (let i = 0; i <= steps; i++) this.table[i] = this.exactLift((i / 4) * 0.5 * DEG);
  }
  private exactLift(xCam: number): number {
    if (xCam >= this.extent) return 0;
    return this.liftM * Math.pow(0.5 + 0.5 * Math.cos(this.k * xCam), this.gamma);
  }
  /** Lift (m) at cycle angle α (crank degrees, 0..720). */
  lift(alphaDeg: number): number {
    let d = alphaDeg - this.centreDeg - this.phaseDeg;
    if (d > 360) d -= 720;
    else if (d < -360) d += 720;
    const ad = d < 0 ? -d : d;
    if (ad >= this.halfOpenDeg) return 0;
    const x = ad * 4;
    const i = x | 0;
    const f = x - i;
    return this.table[i] + (this.table[i + 1] - this.table[i]) * f;
  }
  /** Opening and closing cycle angles (crank deg) where lift leaves zero. */
  get openCloseDeg(): [number, number] {
    const half = (this.extent / DEG) * 2;
    return [this.centreDeg + this.phaseDeg - half, this.centreDeg + this.phaseDeg + half];
  }
}

/**
 * Douaud–Eyzat delays with an isentropic end-gas temperature predict onset early for modern
 * fast-burn chambers (charge motion, wall heat loss from the end gas); the delay is scaled so
 * premium fuel (ON 95) at CR ≈ 10.5–11 is knock-limited only at low-speed WOT, as production
 * calibrations are.
 */
export let KNOCK_TAU_SCALE = 3;
export function setKnockTauScale(v: number): void {
  KNOCK_TAU_SCALE = v;
}

/** Discharge coefficient vs L/D, from EngineLab parts/camshafts.yaml flow-bench style curves. */
const CD_TABLE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.04, 0.32],
  [0.09, 0.52],
  [0.16, 0.64],
  [0.24, 0.7],
  [0.35, 0.72],
];

export interface CylinderParams {
  boreM: number;
  strokeM: number;
  rodM: number;
  compressionRatio: number;
  cam: CamSpec;
  intakeValves: number;
  exhaustValves: number;
  intakeValveD: number;
  exhaustValveD: number;
  fuelLhv: number;
  stoichAfr: number;
  wallTempK: number;
}

export interface CombustionCommand {
  /** Degrees BTDC. */
  sparkAdvanceDeg: number;
  /** Target lambda for injected fuel. */
  lambda: number;
  fuelEnabled: boolean;
  sparkEnabled: boolean;
  /** Fuel octane number for the end-gas autoignition delay (Douaud–Eyzat). */
  fuelOctane: number;
  /** Per-cylinder closed-loop knock control (retard on knock, slow recovery). */
  knockControl: boolean;
}

export class Cylinder {
  readonly area: number;
  readonly crankRadius: number;
  readonly sweptVolume: number;
  readonly clearanceVolume: number;
  /** Active lobes (low cam, or the high cam when lift switching is engaged). */
  intakeLobe: CamLobe;
  exhaustLobe: CamLobe;
  private readonly lowIntake: CamLobe;
  private readonly lowExhaust: CamLobe;
  private readonly highIntake: CamLobe | null = null;
  private readonly highExhaust: CamLobe | null = null;
  private readonly lambdaRod: number;
  private readonly woschniBore: number;
  private hWoschni = 0;
  private heatTick = 0;
  // Valve-solve scratch state (no closures in the audio loop)
  private vsXi = 1;
  private vsB = 1;
  private vsN = 5;
  private vsInvK = 7;
  private vsK = 0;
  private vsOut = 0;
  private vsPm = P_AMBIENT;
  private vsDcOut = 0;
  private vsMeanFlow = 0;
  private vsPowN: PowTable = waveExponents(GAMMA_GAS).n;
  private vsPowInvK: PowTable = waveExponents(GAMMA_GAS).invK;
  private vsT = 0;
  private vsCdA = 0;
  private vsM0 = 0;
  private vsU0 = 0;
  private vsT0 = 0;
  private vsDt = 0;
  private prevExhaustD = 0;
  private prevIntakeD = 0;
  private prevExhaustD2 = 0;
  private prevIntakeD2 = 0;

  // Thermodynamic state
  mass = 0;
  energy = 0;
  pressure = P_AMBIENT;
  temperature = 330;
  volume = 0;
  massAir = 0;
  massFuel = 0;
  massBurned = 0;
  /** Burned gas pushed back into the intake runner during reversion, re-inducted first. */
  runnerResidual = 0;
  /** Burned-gas capacity of this cylinder's runner (kg); excess spills into the plenum pool. */
  runnerResidualCapacity = 1;
  /** Burned fraction of the plenum gas this cylinder inducts (set by the engine each sample). */
  plenumBurnedFraction = 0;
  /** Burned gas spilled from the runner into the plenum this sample (kg), and taken from it. */
  spilledToPlenum = 0;
  takenFromPlenum = 0;

  // Combustion
  private burning = false;
  private burnStartDeg = 0;
  private burnDurationDeg = 50;
  private burnEfficiency = 1;
  private burnFraction = 0;
  private burnQ = 0;
  private prevAlpha = 0;
  private wiebeA = 5;
  private wiebeM = 2;

  // Knock: Livengood–Wu integral of the end gas, compressed isentropically from the spark state.
  /** Spark retard this cylinder's knock controller currently applies, degrees. */
  knockRetard = 0;
  /** Autoignition integral reached by 90 % burn (≥ 1 → knock) on the last cycle. */
  lastKnockIntegral = 0;
  /** Unburned fraction at knock onset on the last cycle (0 = no knock). */
  lastKnockIntensity = 0;
  /** Set true the sample knock onset occurs; consumed by the engine. */
  knocked = false;
  private knockIntegral = 0;
  private knockPending = false;
  private sparkPressure = P_AMBIENT;
  private sparkTemperature = 600;
  private knockAmp = 0;
  private knockPhase = 0;
  private knockOmega = 0;
  private knockDecay = 0;
  private effectiveAdvance = 0;

  // Outputs per sample
  /** Waves leaving the valve ends into the exhaust primary (end a) and intake runner (end b). */
  exhaustSend = 0;
  intakeSend = 0;
  exhaustMassFlow = 0;
  intakeMassFlow = 0;
  /** Effective exhaust valve flow area this sample (m²), for throat-jet noise. */
  exhaustCdA = 0;
  /** Unburned fuel mass sent to the exhaust this sample (kg). */
  unburnedFuelOut = 0;
  /** Exhaust gas temperature of the outflow (K). */
  exhaustGasTemp = 900;
  /** Indicated torque contribution (N·m). */
  torque = 0;
  /** Rate of pressure rise (Pa/s), excitation for block structure. */
  pressureRate = 0;
  /** Knock ringing pressure superposed on the mean chamber pressure this sample (Pa). */
  knockPressure = 0;
  heatReleaseRate = 0;
  /** Last completed cycle diagnostics. */
  lastPeakPressure = 0;
  lastTrappedAir = 0;
  lastImep = 0;
  /** Crank angle of peak pressure, degrees after firing TDC (MBT ≈ 14–18°). */
  lastPeakAngle = 0;
  /**
   * Fixed manufacturing offsets of this cylinder (port/valve flow, burn rate, injector flow).
   * Cylinder-to-cylinder spread is what puts real energy on the non-firing orders.
   */
  flowScale = 1;
  burnScale = 1;
  fuelScale = 1;
  /** Burned-gas (residual + EGR) mass fraction of the charge at the last spark. */
  lastResidualFraction = 0;
  /** Burn duration (Wiebe Δθ) the last combustion event used, before cycle-to-cycle scatter. */
  lastBurnDuration = 70;
  private cyclePeakAngle = 0;
  private cyclePeak = 0;
  private cycleWork = 0;
  /** Set true the sample a firing event (spark) happens; consumed by the engine. */
  sparked = false;
  misfired = false;
  /** Valve closing events (for valvetrain impacts), cleared each sample. */
  intakeClosed = false;
  exhaustClosed = false;
  private intakeWasOpen = false;
  private exhaustWasOpen = false;

  constructor(readonly params: CylinderParams, readonly fireAngleDeg: number, private readonly rng: Rng) {
    const { boreM, strokeM, rodM, compressionRatio, cam } = params;
    this.area = (Math.PI / 4) * boreM * boreM;
    this.crankRadius = strokeM / 2;
    this.sweptVolume = this.area * strokeM;
    this.clearanceVolume = this.sweptVolume / Math.max(1.5, compressionRatio - 1);
    this.lambdaRod = this.crankRadius / rodM;
    this.woschniBore = 3.26 * Math.pow(boreM, -0.2);
    // Cycle angle 0 = firing TDC, 360 = overlap TDC.
    this.lowIntake = new CamLobe(360 + cam.intakeCenterlineDeg, cam.intakeDurationDeg, cam.intakeLiftMm / 1000, cam.gamma);
    this.lowExhaust = new CamLobe(360 - cam.exhaustCenterlineDeg, cam.exhaustDurationDeg, cam.exhaustLiftMm / 1000, cam.gamma);
    if (cam.liftSwitch) {
      const h = cam.liftSwitch;
      this.highIntake = new CamLobe(360 + cam.intakeCenterlineDeg, h.intakeDurationDeg, h.intakeLiftMm / 1000, cam.gamma);
      this.highExhaust = new CamLobe(360 - cam.exhaustCenterlineDeg, h.exhaustDurationDeg, h.exhaustLiftMm / 1000, cam.gamma);
    }
    this.intakeLobe = this.lowIntake;
    this.exhaustLobe = this.lowExhaust;
  }

  /**
   * Valve timing from the ECU: phaser positions (crank degrees; intake advance moves the lobe
   * earlier, exhaust retard later) and the lift-switch state. A switch takes effect only while
   * the follower is on the base circle of both lobes, as the locking pins require.
   */
  setValveTiming(intakeAdvanceDeg: number, exhaustRetardDeg: number, highCam: boolean, alphaDeg: number): void {
    for (const lobe of [this.lowIntake, this.highIntake]) if (lobe) lobe.phaseDeg = -intakeAdvanceDeg;
    for (const lobe of [this.lowExhaust, this.highExhaust]) if (lobe) lobe.phaseDeg = exhaustRetardDeg;
    const wantHigh = highCam && this.highIntake !== null;
    const isHigh = this.intakeLobe === this.highIntake;
    if (wantHigh !== isHigh && this.intakeLobe.lift(alphaDeg) === 0 && this.exhaustLobe.lift(alphaDeg) === 0) {
      this.intakeLobe = wantHigh ? this.highIntake! : this.lowIntake;
      this.exhaustLobe = wantHigh ? this.highExhaust! : this.lowExhaust;
    }
  }

  /** Piston displacement from TDC (m) and its derivative wrt crank angle (m/rad) at cycle angle α. */
  kinematics(alphaDeg: number): [number, number] {
    const a = alphaDeg * DEG;
    const r = this.crankRadius;
    const l = r / this.lambdaRod;
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    const root = Math.sqrt(l * l - r * r * sa * sa);
    const s = r * (1 - ca) + l - root;
    const ds = r * sa * (1 + (r * ca) / root);
    return [s, ds];
  }

  initialise(alphaDeg: number, pressurePa: number, temperatureK: number): void {
    const [s] = this.kinematics(alphaDeg);
    this.volume = this.clearanceVolume + this.area * s;
    this.mass = (pressurePa * this.volume) / (R_AIR * temperatureK);
    this.energy = this.mass * CV_GAS * temperatureK;
    this.massAir = this.mass * 0.92;
    this.massBurned = this.mass * 0.08;
    this.massFuel = 0;
    this.pressure = pressurePa;
    this.temperature = temperatureK;
    this.prevAlpha = alphaDeg;
  }

  private updateState(): void {
    this.temperature = Math.max(200, this.energy / (this.mass * CV_GAS));
    this.pressure = (this.mass * R_AIR * this.temperature) / this.volume;
  }

  /**
   * Advance one sample.
   * @param alphaDeg cycle angle (0 = firing TDC) at the end of the step
   * @param omega crank angular speed (rad/s)
   */
  step(
    alphaDeg: number,
    omega: number,
    dt: number,
    exhaustPort: Port,
    intakePort: Port,
    intakeTempK: number,
    combustion: CombustionCommand,
    dilutionCovGain: number,
  ): void {
    this.sparked = false;
    this.misfired = false;
    this.spilledToPlenum = 0;
    this.takenFromPlenum = 0;
    this.intakeClosed = false;
    this.exhaustClosed = false;
    this.knocked = false;
    const prevPressure = this.pressure;
    const prev = this.prevAlpha;
    this.prevAlpha = alphaDeg;

    // ---- Volume change: reversible piston work on the contents
    const [s, dsdth] = this.kinematics(alphaDeg);
    const newVolume = this.clearanceVolume + this.area * s;
    const dV = newVolume - this.volume;
    this.energy -= this.pressure * dV;
    this.volume = newVolume;

    // ---- Spark event (crossing of the spark angle, handling the 720° wrap)
    this.effectiveAdvance = combustion.sparkAdvanceDeg - (combustion.knockControl ? this.knockRetard : 0);
    const sparkAngle = 720 - this.effectiveAdvance;
    if (crossed(prev, alphaDeg, sparkAngle)) this.ignite(combustion, omega, dilutionCovGain);

    // ---- Combustion heat release (Wiebe)
    this.heatReleaseRate = 0;
    if (this.burning) {
      let theta = alphaDeg - this.burnStartDeg;
      if (theta < -360) theta += 720;
      const exhaustOpening = this.exhaustLobe.lift(alphaDeg) > 0.0003;
      if (theta > 0 && !exhaustOpening) {
        const x = 1 - Math.exp(-this.wiebeA * Math.pow(Math.min(1.5, theta / this.burnDurationDeg), this.wiebeM + 1));
        const dx = Math.max(0, x - this.burnFraction);
        this.burnFraction = x;
        const dQ = dx * this.burnQ;
        this.energy += dQ;
        this.heatReleaseRate = dQ / dt;
        // composition: burn stoichiometric air + fuel
        const fuelBurn = Math.min(this.massFuel, (dQ / (this.params.fuelLhv * this.burnEfficiency)));
        const airBurn = Math.min(this.massAir, fuelBurn * this.params.stoichAfr);
        this.massFuel -= fuelBurn;
        this.massAir -= airBurn;
        this.massBurned += fuelBurn + airBurn;
        if (this.knockPending) this.integrateKnock(x, dt, combustion);
        if (x > 0.999) this.burning = false;
      } else if (exhaustOpening && theta > 0) {
        // Exhaust valve opened before the burn completed: remaining fuel leaves unburned (late/partial burn).
        this.burning = false;
        if (this.knockPending) this.finishKnockCycle(0, combustion);
      }
    }

    // ---- Wall heat transfer (Woschni), coefficient refreshed every 8 samples
    this.updateState();
    if ((this.heatTick++ & 7) === 0) {
      const meanPistonSpeed = (2 * this.params.strokeM * omega) / (2 * Math.PI);
      const w = (alphaDeg < 180 || alphaDeg > 540 ? 2.28 : 6.18) * meanPistonSpeed + (this.burnFraction > 0 && this.burnFraction < 0.999 ? 4 : 0);
      this.hWoschni = this.woschniBore * Math.pow((this.pressure / 1000) * Math.max(0.5, w), 0.8) * Math.pow(this.temperature, -0.55);
    }
    const wallArea = 2 * this.area + Math.PI * this.params.boreM * (this.volume / this.area);
    this.energy -= this.hWoschni * wallArea * (this.temperature - this.params.wallTempK) * dt;
    this.updateState();

    // ---- Exhaust valve
    const exLift = this.exhaustLobe.lift(alphaDeg);
    this.exhaustMassFlow = 0;
    this.unburnedFuelOut = 0;
    if (exLift > 0) {
      const cdA = flowArea(exLift, this.params.exhaustValveD, this.params.exhaustValves) * this.flowScale;
      this.exhaustCdA = cdA;
      this.exhaustMassFlow = this.solveValve(cdA, exhaustPort, true, dt, 0);
      this.exhaustWasOpen = true;
    } else {
      this.exhaustCdA = 0;
      this.prevExhaustD = 0;
      this.prevExhaustD2 = 0;
      this.exhaustSend = arriving(exhaustPort); // closed valve: rigid end
      if (this.exhaustWasOpen) this.exhaustClosed = true;
      this.exhaustWasOpen = false;
    }

    // ---- Intake valve
    const inLift = this.intakeLobe.lift(alphaDeg);
    this.intakeMassFlow = 0;
    if (inLift > 0) {
      const cdA = flowArea(inLift, this.params.intakeValveD, this.params.intakeValves) * this.flowScale;
      this.intakeMassFlow = this.solveValve(cdA, intakePort, false, dt, intakeTempK, combustion);
      this.intakeWasOpen = true;
    } else {
      this.intakeSend = arriving(intakePort);
      this.prevIntakeD = 0;
      this.prevIntakeD2 = 0;
      if (this.intakeWasOpen) {
        this.intakeClosed = true;
        this.lastTrappedAir = this.massAir;
      }
      this.intakeWasOpen = false;
    }

    this.updateState();
    this.pressureRate = (this.pressure - prevPressure) / dt;
    this.knockPressure = 0;
    if (this.knockAmp > 1) {
      // Knock ringing: first circumferential chamber mode, d/dt of Δp·e^(−t/τ)·sin(ωt).
      this.knockPhase += this.knockOmega * dt;
      this.pressureRate += this.knockAmp * this.knockOmega * Math.cos(this.knockPhase);
      this.knockPressure = this.knockAmp * Math.sin(this.knockPhase);
      this.knockAmp *= this.knockDecay;
    }
    this.torque = (this.pressure - P_AMBIENT) * this.area * dsdth;
    // Cycle bookkeeping (IMEP over the 720° cycle, peak pressure)
    if (this.pressure > this.cyclePeak) {
      this.cyclePeak = this.pressure;
      this.cyclePeakAngle = alphaDeg > 360 ? alphaDeg - 720 : alphaDeg;
    }
    this.cycleWork += (this.pressure - P_AMBIENT) * dV;
    if (prev > 600 && alphaDeg < 120) {
      this.lastPeakPressure = this.cyclePeak;
      this.lastPeakAngle = this.cyclePeakAngle;
      this.lastImep = this.cycleWork / this.sweptVolume;
      this.cyclePeak = 0;
      this.cycleWork = 0;
    }
  }

  private ignite(cmd: CombustionCommand, omega: number, dilutionCovGain: number): void {
    this.sparked = true;
    const residualFraction = this.massBurned / Math.max(1e-12, this.mass);
    this.lastResidualFraction = residualFraction;
    if (!cmd.sparkEnabled || this.massFuel <= 1e-9) {
      this.misfired = true;
      this.burning = false;
      return;
    }
    const lambda = this.massAir / Math.max(1e-12, this.massFuel * this.params.stoichAfr);
    if (lambda < 0.55 || lambda > 1.65) {
      this.misfired = true;
      return;
    }
    const density = this.mass / this.volume;
    const rpm = (omega * 60) / (2 * Math.PI);
    const baseDuration = wiebeDuration(this.params.boreM, rpm, density, residualFraction, lambda);
    this.lastBurnDuration = baseDuration;
    const lowDensity = clamp((4.5 - density) / 4.5, 0, 1);
    // Cycle-to-cycle variation: COV grows with dilution and low density (idle with large overlap → lope).
    const cov = clamp(0.012 + dilutionCovGain * (1.6 * Math.max(0, residualFraction - 0.08) + 0.05 * lowDensity * lowDensity), 0.012, 0.5);
    const z = this.rng.gaussian();
    const durationFactor = Math.exp(cov * 1.8 * z);
    this.burnDurationDeg = clamp(baseDuration * durationFactor * this.burnScale, 25, 160);
    this.burnEfficiency = clamp(0.97 - 0.25 * Math.max(0, residualFraction - 0.2) - 0.4 * Math.max(0, lambda - 1.25), 0.4, 0.98);
    // Partial burn / misfire probability rises steeply once dilution is heavy.
    if (this.rng.next() < clamp(cov - 0.12, 0, 0.6) * 0.5) {
      this.burnEfficiency *= 0.25 + 0.5 * this.rng.next();
    }
    const burnableFuel = Math.min(this.massFuel, this.massAir / this.params.stoichAfr);
    this.burnQ = burnableFuel * this.params.fuelLhv * this.burnEfficiency;
    this.burnStartDeg = 720 - this.effectiveAdvance;
    this.burnFraction = 0;
    this.burning = true;
    this.sparkPressure = this.pressure;
    this.sparkTemperature = this.temperature;
    this.knockIntegral = 0;
    this.knockPending = true;
  }

  /**
   * Livengood–Wu: ∫dt/τ over the end gas until 90 % burn, τ from Douaud–Eyzat,
   * τ[ms] = 17.68·(ON/100)^3.402·p[atm]^−1.7·exp(3800/Tu), with the unburned temperature from
   * isentropic compression of the spark-time charge (γu ≈ 1.32). Onset (integral ≥ 1) rings the
   * chamber with an amplitude set by the end-gas fraction still unburned.
   */
  private integrateKnock(x: number, dt: number, cmd: CombustionCommand): void {
    const p = Math.max(this.pressure, 1e4);
    const tu = this.sparkTemperature * Math.pow(p / Math.max(1e4, this.sparkPressure), 0.2424);
    const tauS = KNOCK_TAU_SCALE * 17.68e-3 * Math.pow(cmd.fuelOctane / 100, 3.402) * Math.pow(p / P_AMBIENT, -1.7) * Math.exp(3800 / tu);
    this.knockIntegral += dt / tauS;
    if (this.knockIntegral >= 1) {
      this.finishKnockCycle(1 - x, cmd);
      // Draper's first circumferential mode f = 1.84·c/(πB) in the burned gas.
      const c = Math.sqrt(1.3 * R_AIR * this.temperature);
      const f = Math.min((1.84 * c) / (Math.PI * this.params.boreM), 20000);
      this.knockOmega = 2 * Math.PI * f;
      this.knockPhase = 0;
      this.knockAmp = 0.5 * (1 - x) * p;
      // Q ≈ 18: τ = Q/(πf).
      this.knockDecay = Math.exp((-dt * Math.PI * f) / 18);
      this.knocked = true;
    } else if (x >= 0.9) {
      this.finishKnockCycle(0, cmd);
    }
  }

  private finishKnockCycle(intensity: number, cmd: CombustionCommand): void {
    this.knockPending = false;
    this.lastKnockIntegral = intensity > 0 ? Math.max(1, this.knockIntegral) : this.knockIntegral;
    this.lastKnockIntensity = intensity;
    if (!cmd.knockControl) return;
    // Production-style controller: fast retard on knock, a little on near-borderline cycles, slow recovery.
    if (intensity > 0) this.knockRetard += 2.5 + 10 * intensity;
    else if (this.knockIntegral > 0.85) this.knockRetard += 6 * (this.knockIntegral - 0.85);
    else this.knockRetard -= 0.3;
    this.knockRetard = clamp(this.knockRetard, 0, 30);
  }

  /**
   * Implicit valve flow against a duct end, with finite-amplitude wave superposition (Benson /
   * Blair) for the pulsating part of the waves: each carries a pressure amplitude ratio
   * X = (p/p_m)^k, k = (γ−1)/2γ, referred to the duct's own mean state (p_m, c). The slow (DC)
   * parts stay linear, so the mean flow and mean pressure agree with the linear junctions. At the port the incident
   * and outgoing waves superpose as X_s = X_i + X_r − 1, so p = p_ref·X_s^(1/k), particle velocity
   * into the duct u = (2c/(γ−1))·(X_r − X_i) and ρ = ρ_ref·X_s^(2/(γ−1)). Suction saturates
   * (pressure can't pass zero) and compression steepens, as in a real port; for small amplitudes
   * it reduces to the linear relation p = 2p_in + (c/A)·ṁ used by the junctions. The secant's
   * unknown is D = X_r − X_i; `out` (mass flow leaving the cylinder into the duct) follows from it.
   */
  private solveValve(cdA: number, port: Port, isExhaust: boolean, dt: number, intakeTempK: number, combustion?: CombustionCommand): number {
    const duct = port.duct;
    const pin = arriving(port);
    const Tduct = isExhaust ? duct.temperatureK : intakeTempK;
    const gam = duct.gamma;
    const k = (gam - 1) / (2 * gam);
    const n = 2 / (gam - 1);
    const dcIn = duct.dcArriving(port.end);
    const dcOut = duct.dcLeaving(port.end);
    const pm = Math.max(0.05 * P_AMBIENT, P_AMBIENT + dcIn + dcOut);
    const tables = waveExponents(gam);
    this.vsPowN = tables.n;
    this.vsPowInvK = tables.invK;
    const xi = tables.k.at(1 + (pin - dcIn) / pm);
    this.vsPm = pm;
    this.vsDcOut = dcOut;
    this.vsXi = xi;
    this.vsB = 2 * xi - 1;
    this.vsN = n;
    this.vsInvK = 1 / k;
    // ρ_m·A·u-scale: ρ_m = γ·p_m/c², u = n·c·D; plus the linear mean flow of the DC waves.
    this.vsK = ((gam * pm) / (duct.c * duct.c)) * duct.area * n * duct.c;
    this.vsMeanFlow = (duct.area / duct.c) * (dcOut - dcIn);
    this.vsT = Tduct;
    this.vsCdA = cdA;
    this.vsM0 = this.mass;
    this.vsU0 = this.energy;
    this.vsT0 = this.temperature;
    this.vsDt = dt;
    // Warm start from the previous sample (flows are smooth), secant refinement; fall back to a
    // bracketed Illinois solve between 0 and the explicit estimate if the secant misbehaves.
    // Linear predictor from the last two samples' solutions.
    const dPrev = isExhaust ? this.prevExhaustD : this.prevIntakeD;
    const dPrev2 = isExhaust ? this.prevExhaustD2 : this.prevIntakeD2;
    let x0 = 2 * dPrev - dPrev2;
    let g0 = this.valveResidual(x0);
    let d = x0;
    let converged = Math.abs(g0) < 1e-9 + 1e-6 * Math.abs(this.vsOut);
    let x1 = x0;
    let g1 = g0;
    if (!converged) {
      x1 = x0 - g0 / this.dOutdD(x0);
      g1 = this.valveResidual(x1);
      d = x1;
    }
    for (let it = 0; it < 6 && !converged; it++) {
      if (Math.abs(g1) < 1e-9 + 1e-6 * Math.abs(this.vsOut)) { converged = true; d = x1; break; }
      const denom = g1 - g0;
      if (denom === 0) break;
      const x2 = x1 - (g1 * (x1 - x0)) / denom;
      x0 = x1; g0 = g1;
      x1 = x2; g1 = this.valveResidual(x1);
      d = x1;
    }
    if (!converged && !(Math.abs(g1) < 1e-8 + 1e-5 * Math.abs(this.vsOut))) {
      let a = 0;
      let fa = this.valveResidual(0);
      d = 0;
      if (fa !== 0) {
        let b = -fa / this.dOutdD(0);
        let fb = this.valveResidual(b);
        d = b;
        if (Math.sign(fa) !== Math.sign(fb)) {
          for (let it = 0; it < 30; it++) {
            d = fb !== fa ? b - (fb * (b - a)) / (fb - fa) : 0.5 * (a + b);
            const fo = this.valveResidual(d);
            if (Math.abs(fo) < 1e-10 + 1e-7 * Math.abs(this.vsOut)) break;
            if (Math.sign(fo) === Math.sign(fb)) { b = d; fb = fo; fa *= 0.5; } else { a = d; fa = fo; fb *= 0.5; }
          }
        }
      }
    }
    // Every path above ends with the residual evaluated at d, so vsOut already holds its flow.
    const out = this.vsOut;
    if (isExhaust) {
      this.prevExhaustD2 = this.prevExhaustD;
      this.prevExhaustD = d;
    } else {
      this.prevIntakeD2 = this.prevIntakeD;
      this.prevIntakeD = d;
    }

    // Apply the flow to the cylinder contents.
    const dm = out * dt;
    if (out >= 0) {
      const frac = Math.min(0.98, dm / Math.max(1e-12, this.mass));
      const lostAir = this.massAir * frac;
      const lostFuel = this.massFuel * frac;
      const lostBurned = this.massBurned * frac;
      this.massAir -= lostAir;
      this.massFuel -= lostFuel;
      this.massBurned -= lostBurned;
      this.energy -= CP_GAS * this.temperature * dm;
      this.mass -= dm;
      if (isExhaust) {
        this.unburnedFuelOut = lostFuel;
        this.exhaustGasTemp = this.temperature;
      } else {
        // Reversion into the intake runner: burned gas waits there and is re-inducted first;
        // beyond the runner's own capacity it spills into the shared plenum.
        this.runnerResidual += lostBurned;
        if (this.runnerResidual > this.runnerResidualCapacity) {
          this.spilledToPlenum += this.runnerResidual - this.runnerResidualCapacity;
          this.runnerResidual = this.runnerResidualCapacity;
        }
      }
    } else {
      const gain = -dm;
      this.mass += gain;
      this.energy += CP_GAS * Tduct * gain;
      if (isExhaust) {
        this.massBurned += gain; // exhaust back-flow during overlap: internal EGR
      } else {
        const fromResidual = Math.min(this.runnerResidual, gain);
        this.runnerResidual -= fromResidual;
        const fromPlenum = (gain - fromResidual) * this.plenumBurnedFraction;
        this.takenFromPlenum += fromPlenum;
        const fresh = gain - fromResidual - fromPlenum;
        this.massBurned += fromResidual + fromPlenum;
        const fuelFraction = combustion && combustion.fuelEnabled ? 1 / (1 + combustion.lambda * this.params.stoichAfr / this.fuelScale) : 0;
        this.massFuel += fresh * fuelFraction;
        this.massAir += fresh * (1 - fuelFraction);
      }
    }
    this.mass = Math.max(1e-9, this.mass);
    this.updateState();

    // Outgoing wave as its own gauge amplitude: p_ref·(X_r^(1/k) − 1).
    const send = this.vsDcOut + this.vsPm * (this.vsPowInvK.at(this.vsXi + d) - 1);
    if (isExhaust) this.exhaustSend = send;
    else this.intakeSend = send;
    return isExhaust ? out : -out;
  }

  /** dṁ/dD at D (for scaling secant starts). */
  private dOutdD(d: number): number {
    const xs = Math.max(0.05, this.vsB + d);
    const xn = this.vsPowN.at(xs);
    return Math.max(1e-9, this.vsK * (xn + (this.vsN * d * xn) / xs));
  }

  /**
   * g(D) = ṁ_wave(D) − F(p_cyl(ṁ), p_port(D)); monotone increasing in D. Sets vsOut = ṁ_wave.
   */
  private valveResidual(d: number): number {
    const xs = Math.max(0.05, this.vsB + d);
    const out = this.vsMeanFlow + this.vsK * d * this.vsPowN.at(xs);
    this.vsOut = out;
    const pPort = this.vsPm * this.vsPowInvK.at(xs);
    const dm = out * this.vsDt;
    const m0 = this.vsM0;
    const m = Math.max(m0 * 0.02, m0 - dm);
    const U = out >= 0 ? this.vsU0 - CP_GAS * this.vsT0 * dm : this.vsU0 - CP_GAS * this.vsT * dm;
    const Uc = Math.max(U, m * CV_GAS * 200);
    const pc = ((GAMMA_GAS - 1) * Uc) / this.volume;
    const tc = Uc / (m * CV_GAS);
    return out - orificeMassFlow(this.vsCdA, pc, tc, pPort, this.vsT);
  }
}

/**
 * Wiebe 0–100 % burn duration (crank degrees). Flame travel scales with bore; turbulence scales with
 * piston speed so the crank-angle duration is nearly rpm-independent, rising slowly at high speed;
 * dilution (residual), low charge density and off-stoichiometric mixture slow the flame
 * (Heywood, Internal Combustion Engine Fundamentals, ch. 9; Wiebe a = 5, m = 2).
 */
export function wiebeDuration(boreM: number, rpm: number, chargeDensity: number, residualFraction: number, lambda: number): number {
  const lowDensity = clamp((4.5 - chargeDensity) / 4.5, 0, 1);
  return (
    62 * Math.pow(boreM / 0.09, 0.45) +
    6 * clamp(rpm / 7000, 0, 2) +
    70 * Math.max(0, residualFraction - 0.06) +
    30 * lowDensity +
    35 * Math.abs(lambda - 0.92)
  );
}

/** Spark advance placing 50 % burn at ~9° ATDC (MBT) for a Wiebe(a=5, m=2) burn. */
export function mbtAdvance(durationDeg: number): number {
  return 0.517 * durationDeg - 9;
}

function crossed(prev: number, cur: number, target: number): boolean {
  if (cur >= prev) return prev < target && cur >= target;
  // wrapped through 720 → 0: target lies in (prev, 720) or [0, cur]
  return prev < target || target <= cur;
}

function flowArea(liftM: number, valveD: number, count: number): number {
  const ld = liftM / valveD;
  const cd = lerpTable(CD_TABLE, ld);
  const curtain = Math.PI * valveD * liftM;
  const throat = Math.PI * 0.25 * valveD * valveD * 0.88;
  return cd * Math.min(curtain, throat) * count;
}


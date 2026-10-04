/**
 * Vehicle drivetrain for the "vehicle" drive mode: gearbox, friction clutch, vehicle inertia and
 * road load, with an automated sequential/DCT-style shift controller and launch control.
 *
 * The driveline is a torsional spring-damper (≈5 Hz shuffle mode, ζ ≈ 0.3) in series with a
 * stick–slip friction clutch. Through the spring the vehicle's inertia, reflected by the gearing,
 * loads the crankshaft, which is why an engine in gear sounds heavier than in neutral (slower load
 * response, tip-in shuffle) while firing pulses still ripple the crank speed as they do on a car.
 */
import { clamp } from "./gas";

export interface VehicleSpec {
  massKg: number;
  tireRadiusM: number;
  gearRatios: number[];
  finalDrive: number;
  /** Driveline efficiency (gearbox + final drive). */
  efficiency: number;
  /** Aerodynamic drag area Cd·A, m². */
  cdA: number;
  rollingResistance: number;
  clutchCapacityNm: number;
  /** Automatic upshift speed under load, rpm. */
  shiftRpm: number;
  /** Launch-control hold speed, rpm. */
  launchRpm: number;
}

export interface VehicleControls {
  autoShift: boolean;
  launchControl: boolean;
  /** Brake pedal 0..1. */
  brake: number;
}

type ShiftPhase = "drive" | "cut" | "select" | "engage";

export interface DrivetrainOutput {
  /** Engine speed after this sample, rad/s. */
  omega: number;
  /** Torque the clutch takes from the crank, N·m. */
  clutchTorque: number;
}

const G = 9.81;
const RHO_AIR = 1.2;

export class Drivetrain {
  gear = 1;
  /** Vehicle speed, m/s. */
  speed = 0;
  /** Clutch engagement 0 (open) … 1 (closed). */
  clutch = 0;
  locked = false;
  phase: ShiftPhase = "drive";
  /** Ignition cut requested by the shift controller (torque interruption). */
  shiftCut = false;
  /** Throttle override for a rev-matching blip on downshifts (null = driver's pedal). */
  blipThrottle: number | null = null;
  private phaseTime = 0;
  private pendingGear = 1;
  private shiftDir = 0;
  private wheelOmega = 0;
  /** Driveline wind-up angle at the engine side, rad. */
  private twist = 0;
  private readonly wheelInertia: number;

  constructor(readonly spec: VehicleSpec, private readonly idleRpm: number, private readonly redlineRpm: number) {
    // Four road wheels with tyres and brake rotors, ≈ 1.1 kg·m² each (motorcycles: two, lighter).
    this.wheelInertia = spec.massKg < 600 ? 1.2 : 4.4;
  }

  /** Overall ratio engine:wheel for the engaged gear (0 in neutral). */
  get ratio(): number {
    return this.gear > 0 ? this.spec.gearRatios[this.gear - 1] * this.spec.finalDrive : 0;
  }

  requestShift(dir: 1 | -1): void {
    if (this.phase !== "drive") return;
    const target = clamp(this.gear + dir, 1, this.spec.gearRatios.length);
    if (target === this.gear) return;
    this.pendingGear = target;
    this.shiftDir = dir;
    this.phase = "cut";
    this.phaseTime = 0;
  }

  /** Block-rate shift and clutch logic. */
  /**
   * @param engineTorqueNm smoothed net engine torque (indicated − friction), for clutch torque control
   * @param engineInertia crank + flywheel inertia, kg·m²
   */
  control(dt: number, rpm: number, pedal: number, controls: VehicleControls, engineTorqueNm = 0, engineInertia = 0.2): void {
    const s = this.spec;
    this.phaseTime += dt;
    if (controls.autoShift && this.phase === "drive") {
      if (rpm > s.shiftRpm && pedal > 0.6 && this.gear < s.gearRatios.length && this.locked) this.requestShift(1);
      else if (this.gear > 1 && this.locked && rpm < Math.max(this.idleRpm * 1.6, this.redlineRpm * 0.28) && pedal < 0.5) this.requestShift(-1);
    }
    this.shiftCut = false;
    this.blipThrottle = null;
    switch (this.phase) {
      case "cut":
        // Torque interruption while the clutch opens (~40 ms); flat-shift: driver stays on the pedal.
        this.shiftCut = this.shiftDir > 0 && pedal > 0.3;
        this.clutch = Math.max(0, this.clutch - dt / 0.04);
        if (this.clutch <= 0) {
          this.phase = "select";
          this.phaseTime = 0;
        }
        break;
      case "select":
        this.shiftCut = this.shiftDir > 0 && pedal > 0.3;
        if (this.shiftDir < 0) this.blipThrottle = 0.55; // rev-match the lower gear
        if (this.phaseTime > 0.06) {
          this.gear = this.pendingGear;
          this.phase = "engage";
          this.phaseTime = 0;
        }
        break;
      case "engage": {
        // Upshift: hold the torque cut until the clutch has mostly re-engaged, or the free engine flares.
        this.shiftCut = this.shiftDir > 0 && pedal > 0.3 && this.clutch < 0.7;
        const syncRpm = (this.wheelOmega * this.ratio * 60) / (2 * Math.PI);
        if (this.shiftDir < 0 && rpm < syncRpm * 0.95) this.blipThrottle = 0.55;
        this.clutch = Math.min(1, this.clutch + dt / 0.12);
        if (this.clutch >= 1) this.phase = "drive";
        break;
      }
      default: {
        // Automated clutch. Once synchronised it stays closed. Pulling away, it slips under speed
        // control: engagement rises while the engine is above a pedal-dependent launch speed and
        // falls below it, so the engine holds its launch speed until the car catches up (no bog,
        // no flare). At a standstill with the pedal released it stays open (no creep).
        const target = this.idleRpm + 300 + pedal * (s.launchRpm - this.idleRpm - 300);
        const syncRpm = (this.wheelOmega * this.ratio * 60) / (2 * Math.PI);
        const launching = this.gear === 1 && syncRpm < target;
        if (this.locked || !launching) this.clutch = Math.min(1, this.clutch + dt / 0.2);
        else if (pedal < 0.05 && this.speed < 2.5) this.clutch = Math.max(0, this.clutch - dt / 0.15);
        else {
          // Clutch torque = engine torque + J·k·(ω − ω_target): holds the launch speed, k ≈ 12/s.
          const err = ((rpm - target) * 2 * Math.PI) / 60;
          const want = clamp((Math.max(0, engineTorqueNm) + engineInertia * 12 * err) / s.clutchCapacityNm, 0, 1);
          this.clutch += clamp(want - this.clutch, -dt / 0.05, dt / 0.05);
        }
        // Stall protection: open the clutch if the engine is being dragged under idle.
        if (rpm < this.idleRpm * 0.85 && this.speed < 6) this.clutch = Math.max(0, this.clutch - dt / 0.1);
      }
    }
  }

  /** Launch control holds this speed while standing (ignition-cut limiter), or null. */
  launchHoldRpm(controls: VehicleControls): number | null {
    return controls.launchControl && this.speed < 1.5 && this.gear === 1 ? this.spec.launchRpm : null;
  }

  /**
   * Advance one sample.
   * @param engineTorque indicated − friction − accessory/FI torque at the crank, N·m
   * @param omega engine speed, rad/s
   * @param Je engine rotating inertia, kg·m²
   */
  step(dt: number, engineTorque: number, omega: number, Je: number, brake: number): DrivetrainOutput {
    const s = this.spec;
    const r = s.tireRadiusM;
    const Jv = s.massKg * r * r + this.wheelInertia;
    const v = this.speed;
    const road = (0.5 * RHO_AIR * s.cdA * v * v + (v > 0.05 ? s.rollingResistance * s.massKg * G : 0)) * r;
    const brakeTorque = brake * 0.9 * s.massKg * G * r * (v > 0.05 ? 1 : 0);
    const resist = road + brakeTorque;
    const Gr = this.ratio;
    const cap = this.clutch * s.clutchCapacityNm;
    let Tc = 0;
    if (Gr === 0 || cap < 1) {
      this.locked = false;
      this.twist = 0;
    } else {
      // Compliant driveline (clutch damper springs, shafts, tyres) in series with a stick–slip
      // friction clutch: the spring carries the torque while it is within the clutch's capacity;
      // beyond it the clutch slips at capacity and the spring stays at its limit.
      const k = Je * Math.pow(2 * Math.PI * 5, 2);
      const c = 2 * 0.3 * Math.sqrt(k * Je);
      const slipRate = omega - Gr * this.wheelOmega;
      const Tspring = k * this.twist + c * slipRate;
      if (Math.abs(Tspring) <= cap) {
        Tc = Tspring;
        this.twist += slipRate * dt;
        this.locked = true;
      } else {
        Tc = Math.sign(Tspring) * cap;
        this.twist = (Tc - c * slipRate) / k;
        this.locked = false;
      }
    }
    const eta = Tc >= 0 ? s.efficiency : 1 / s.efficiency;
    let wheelAccel = (Tc * Gr * eta - resist) / Jv;
    if (this.wheelOmega <= 0 && wheelAccel < 0) wheelAccel = 0;
    this.wheelOmega = Math.max(0, this.wheelOmega + wheelAccel * dt);
    this.speed = this.wheelOmega * r;
    const next = omega + ((engineTorque - Tc) / Je) * dt;
    return { omega: Math.max(0, next), clutchTorque: Tc };
  }
}

/**
 * Top speed where the estimated wheel power meets aerodynamic drag and rolling resistance:
 * P = (½ρ·CdA·v² + m·g·Crr)·v, solved by bisection.
 */
function powerLimitedTopSpeed(wheelPowerW: number, massKg: number, cdA: number, crr: number): number {
  let lo = 5;
  let hi = 150;
  for (let i = 0; i < 50; i++) {
    const v = 0.5 * (lo + hi);
    if ((0.5 * 1.2 * cdA * v * v + massKg * 9.81 * crr) * v > wheelPowerW) hi = v;
    else lo = v;
  }
  return lo;
}

/**
 * Plausible vehicle for an engine. Mass scales with displacement; top gear is set so the engine's
 * usable top speed (redline or limiter, whichever is lower) lands at the power-limited top speed, as
 * production gearing roughly does, so small engines get short gearing and big ones tall.
 */
export function defaultVehicle(displacementL: number, redlineRpm: number, idleRpm: number, motorcycle: boolean, peakTorqueGuessNm: number, limiterRpm = redlineRpm): VehicleSpec {
  const topRpm = Math.min(redlineRpm, limiterRpm);
  // Peak power ≈ 85 % of peak torque at 85 % of the top speed.
  const peakPowerW = 0.85 * peakTorqueGuessNm * ((0.85 * topRpm * 2 * Math.PI) / 60);
  if (motorcycle) {
    const ratios = [2.6, 1.95, 1.6, 1.38, 1.24, 1.13];
    const r = 0.31;
    // Bike (wet) ≈ 110 + 90·L kg, plus an 80 kg rider.
    const massKg = 110 + 90 * displacementL + 80;
    const vTop = clamp(powerLimitedTopSpeed(0.9 * peakPowerW, massKg, 0.5, 0.015), 25, 90);
    const finalDrive = ((topRpm * 2 * Math.PI) / 60) * r / (vTop * ratios[ratios.length - 1]);
    return { massKg, tireRadiusM: r, gearRatios: ratios, finalDrive, efficiency: 0.9, cdA: 0.5, rollingResistance: 0.015, clutchCapacityNm: peakTorqueGuessNm * 2.2, shiftRpm: topRpm * 0.96, launchRpm: Math.round(topRpm * 0.55) };
  }
  const ratios = [3.6, 2.19, 1.54, 1.21, 1.0, 0.84];
  const r = 0.33;
  const massKg = clamp(950 + 150 * displacementL, 800, 2300);
  const vTop = clamp(powerLimitedTopSpeed(0.9 * peakPowerW, massKg, 0.65, 0.012), 35, 105);
  const finalDrive = clamp(((topRpm * 2 * Math.PI) / 60) * r / (vTop * ratios[ratios.length - 1]), 2.4, 5.5);
  return {
    massKg,
    tireRadiusM: r,
    gearRatios: ratios,
    finalDrive,
    efficiency: 0.9,
    cdA: 0.65,
    rollingResistance: 0.012,
    clutchCapacityNm: peakTorqueGuessNm * 1.8,
    shiftRpm: topRpm * 0.96,
    launchRpm: Math.round(clamp(topRpm * 0.55, idleRpm + 1500, 6500)),
  };
}

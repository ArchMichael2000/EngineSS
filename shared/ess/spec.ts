import type { VehicleSpec } from "./vehicle";
/**
 * ESS v16 physical engine specification.
 *
 * Everything the simulator consumes is expressed here in SI-ish engineering
 * units (mm, L, deg, rpm, kg·m²). `resolveEngineSpec()` in resolveSpec.ts maps
 * the app's Quick/Advanced configuration onto this structure, filling gaps with
 * family-typical values whose provenance is recorded in docs/reference-sources.md.
 */

export type EssLayout = "inline" | "v" | "flat" | "w" | "radial";

/**
 * Crank strategy.
 * - even-fire: ideal split-pin crank; fire angles are exactly 720/n apart.
 * - cross-plane: 90° throw spacing (V8 GM style; inline-4 "crossplane" 270-180-90-180).
 * - flat-plane: 180° throw spacing (flat crank of the per-bank inline engine).
 * - common-pin: an even inline crank for the per-bank cylinder count, with each
 *   throw shared by one cylinder per bank. Bank angle then sets the interval
 *   (e.g. 90° V6 → 90/150, 45° V-twin → 315/405).
 * - single-pin: every cylinder on one throw (radial, master-rod engines).
 * - custom: explicit pin angles (crank.pinAnglesDeg) or fire angles (crank.fireAnglesDeg).
 */
export type EssCrankType = "even-fire" | "cross-plane" | "flat-plane" | "common-pin" | "single-pin" | "custom";

export interface CrankSpec {
  type: EssCrankType;
  /** Throw angle per cylinder (index = cylinder number - 1), degrees. Used by `custom`. */
  pinAnglesDeg?: number[];
  /** Firing TDC per cylinder in the 720° cycle (index = cylinder number - 1). Overrides everything. */
  fireAnglesDeg?: number[];
}

export interface CamSpec {
  /** Duration at 0.050" (1.27 mm) tappet lift, crank degrees. */
  intakeDurationDeg: number;
  exhaustDurationDeg: number;
  /** Intake lobe centreline, crank degrees after firing TDC (overlap TDC = 360). */
  intakeCenterlineDeg: number;
  /** Exhaust lobe centreline, crank degrees before overlap TDC. */
  exhaustCenterlineDeg: number;
  intakeLiftMm: number;
  exhaustLiftMm: number;
  /** Harmonic lobe shape exponent (engine-sim convention; 0.7 aggressive … 1.0 gentle). */
  gamma: number;
  /** Cam phaser authority, crank degrees: intake advance and exhaust retard from the base centrelines (0 = fixed cam). */
  intakePhaserDeg: number;
  exhaustPhaserDeg: number;
  /** Two-step lift switching (VTEC, VarioCam Plus, MIVEC): high-cam lobes engaged above `switchRpm` under load. */
  liftSwitch: LiftSwitchSpec | null;
}

export interface LiftSwitchSpec {
  switchRpm: number;
  intakeDurationDeg: number;
  exhaustDurationDeg: number;
  intakeLiftMm: number;
  exhaustLiftMm: number;
}

export interface ValveSpec {
  intakeCount: number;
  exhaustCount: number;
  intakeDiameterMm: number;
  exhaustDiameterMm: number;
}

export type EssIntakeType = "single-throttle-body" | "itbs" | "carb" | "velocity-stacks" | "airbox";
export type EssAirFilter = "oem-paper" | "cone" | "sock" | "none";

export interface IntakeSpec {
  type: EssIntakeType;
  plenumVolumeL: number;
  throttleDiameterMm: number;
  runnerLengthMm: number;
  runnerDiameterMm: number;
  airboxVolumeL: number;
  /** Inlet duct (snorkel) from atmosphere to airbox / throttle. */
  snorkelLengthMm: number;
  snorkelDiameterMm: number;
  filter: EssAirFilter;
  /** Idle-air bypass area at full authority, mm². */
  idleBypassAreaMm2: number;
  /** Helmholtz resonator on the snorkel (OEM intake boom control): tuned Hz (0 = none) and cavity volume L. */
  resonatorHz: number;
  resonatorVolumeL: number;
}

export type CollectorStrategy = "bank" | "firing-alternate" | "pairs-then-bank" | "all" | "none";
export type CrossoverType = "none" | "x-pipe" | "h-pipe";
export type MufflerType = "chambered" | "turbo" | "straight-through" | "glasspack" | "none";
export type ExhaustRoutingType = "single" | "dual" | "open-headers";

export interface MufflerSpec {
  type: MufflerType;
  bodyDiameterMm: number;
  bodyLengthMm: number;
  /** Absorptive packing amount 0 (none) … 1 (dense OEM). */
  packing: number;
}

export interface ExhaustSpec {
  routing: ExhaustRoutingType;
  /** Primary length per cylinder (index = cylinder number - 1), mm. */
  primaryLengthsMm: number[];
  primaryDiameterMm: number;
  collector: CollectorStrategy;
  /** Collector/merge outlet diameter, mm. */
  collectorDiameterMm: number;
  /** Pipe from collector to crossover / catalyst, mm. */
  midPipeLengthMm: number;
  pipeDiameterMm: number;
  crossover: CrossoverType;
  catalyst: boolean;
  resonator: boolean;
  muffler: MufflerSpec;
  tailpipeLengthMm: number;
  tailpipeDiameterMm: number;
  /** Lateral spacing between outlets, m (dual routing). */
  outletSpacingM: number;
  /** Closed-end quarter-wave side branches ("J-pipe" drone killers) ahead of the muffler, tuned frequency Hz. */
  quarterWaveTubesHz: number[];
  /** Helmholtz resonators ahead of the muffler: tuned frequency Hz and cavity volume L. */
  helmholtz: Array<{ tuneHz: number; volumeL: number }>;
  /** Valved exhaust: a bypass parallel to the muffler that opens above `openRpm` (auto) or on command. */
  valve: { openRpm: number; mode: "auto" | "open" | "closed" } | null;
}

export type TurboSizeClass = "small" | "balanced" | "large";
export type SuperchargerKind = "roots" | "twin-screw" | "centrifugal";

export interface TurboSpec {
  kind: "turbo";
  count: number;
  size: TurboSizeClass;
  compressorWheelDiameterMm: number;
  compressorBlades: number;
  turbineBlades: number;
  /** Turbine effective flow area at full nozzle, mm². */
  turbineAreaMm2: number;
  rotorInertiaKgM2: number;
  targetBoostKpa: number;
  wastegate: boolean;
  blowOffValve: boolean;
  /** Charge-pipe + intercooler volume, L. */
  chargeVolumeL: number;
}

export interface SuperchargerSpec {
  kind: "supercharger";
  type: SuperchargerKind;
  /** Displacement per rotor revolution, L (positive-displacement types). */
  displacementL: number;
  /** Pulley ratio rotor:crank. */
  driveRatio: number;
  /** Centrifugal internal step-up ratio (impeller:pulley). */
  stepUpRatio: number;
  lobes: number;
  helixTwistDeg: number;
  timingGearTeeth: number;
  impellerBlades: number;
  impellerDiameterMm: number;
  bypassValve: boolean;
  targetBoostKpa: number;
  whineIntensity: number;
}

export type ForcedInductionSpec = TurboSpec | SuperchargerSpec | { kind: "na" };

export type RevLimiterKind = "soft" | "hard-fuel-cut" | "hard-ignition-cut";

export interface CalibrationSpec {
  idleRpm: number;
  redlineRpm: number;
  revLimiterRpm: number;
  revLimiter: RevLimiterKind;
  /** Fuel octane number (≈ RON) for the end-gas autoignition model. 91–98 pump, ~105 E85, 110+ race. */
  fuelOctane: number;
  /** Closed-loop knock control. Off = spark stays at MBT and the engine knocks audibly where the fuel can't take it. */
  knockControl: boolean;
  /**
   * Cylinder-to-cylinder build tolerance, 0 (identical cylinders) … 1 (loose). At 1: valve/port
   * flow ±3 %, burn rate ±5 %, injector flow ±2.5 % (1σ). Production engines ≈ 0.5, blueprinted race ≈ 0.2.
   */
  buildTolerance: number;
  /** Lambda at WOT (rich) and part load. */
  lambdaWot: number;
  lambdaPart: number;
  /** Decel fuel cut enabled (DFCO). */
  overrunFuelCut: boolean;
  /** 0 … 1 tendency of the calibration to produce exhaust afterfire on overrun / limiter. */
  afterfireTendency: number;
}

export type CombustionKind = "spark" | "diesel";
export type EngineCycleKind = "four-stroke" | "two-stroke" | "rotary";

/**
 * Crankcase-scavenged, piston-ported two-stroke (Blair, *Design and Simulation of Two-Stroke
 * Engines*, SAE 1996). Port timings are crank degrees after TDC at which the piston crown uncovers
 * the port's top edge; ports run down to BDC level.
 */
export interface TwoStrokeSpec {
  exhaustPortOpenDeg: number;
  transferPortOpenDeg: number;
  /** Effective exhaust port width / bore (bridged main port + auxiliaries). */
  exhaustPortWidthRatio: number;
  /** Summed effective transfer port width / bore. */
  transferPortWidthRatio: number;
  /** Crankcase primary compression ratio (V at TDC / V at BDC). */
  crankcaseCompressionRatio: number;
  /** Reed valve into the crankcase, or a piston-controlled intake port. */
  intake: "reed" | "piston-port";
  /** Piston-port intake: opens this many degrees before TDC (symmetric about TDC). */
  intakePortOpenBtdcDeg: number;
  /** Displacement–mixing scavenging exponent: 1 = perfect mixing, ≈1.8 loop, ≈2.5 uniflow-like. */
  scavengeQuality: number;
  /** Tuned expansion chamber per cylinder, tuned for peak power at `tunedRpm`. */
  expansionChamber: boolean;
  tunedRpm: number;
}

/** Direct-injection compression ignition. */
export interface DieselSpec {
  /** Start of main injection at rated speed, degrees BTDC (advances ≈ 1.5°/1000 rpm from idle). */
  injectionAdvanceDeg: number;
  /** Common-rail pilot injection: the main injection lands in a burning pilot (short ignition delay). */
  pilotInjection: boolean;
  cetane: number;
  /** Smoke-limited full-load lambda (fuel is capped to trapped air / (AFR · this)). */
  smokeLambda: number;
  /** Full-load fuel per cylinder per cycle, mg (rated). */
  fullLoadFuelMg: number;
  /**
   * Fixed per-injector delivery offset left after calibration, 1σ in mg per stroke. Injection
   * systems scatter by a roughly constant volume, so the relative spread is largest at idle, where
   * it puts energy on the non-firing orders. Mechanical in-line/distributor pumps ≈ 0.5 mg;
   * common rail with per-cylinder smooth-running control ≈ 0.12 mg.
   */
  injectorSpreadMg: number;
}

/**
 * Wankel rotary (Mazda convention: displacement = rotors × one chamber). Each rotor has three
 * chambers ("faces"), each completing a four-stroke cycle over 1080° of eccentric-shaft rotation.
 * Port events are e-shaft degrees in a face's cycle: 0 = firing TDC, 270 BDC, 540 overlap TDC,
 * 810 BDC. Chamber volume V = V_min + (V_d/2)(1 − cos(2θ/3)), V_d = 3√3·e·R·b (exact).
 */
export interface RotarySpec {
  rotors: number;
  eccentricityMm: number;
  generatingRadiusMm: number;
  rotorWidthMm: number;
  exhaustPort: "peripheral" | "side";
  intakePort: "side" | "peripheral";
  exhaustOpenDeg: number;
  exhaustCloseDeg: number;
  intakeOpenDeg: number;
  intakeCloseDeg: number;
  /** Effective (Cd·A) port areas per rotor at full opening, mm². */
  exhaustAreaMm2: number;
  intakeAreaMm2: number;
}

export interface EngineSpec {
  name: string;
  /** Working cycle; crank degrees per cycle 720 (four-stroke) or 360 (two-stroke). */
  cycle: EngineCycleKind;
  twoStroke: TwoStrokeSpec | null;
  rotary: RotarySpec | null;
  /** Spark ignition or compression ignition (diesel). */
  combustion: CombustionKind;
  diesel: DieselSpec | null;
  layout: EssLayout;
  cylinders: number;
  boreMm: number;
  strokeMm: number;
  rodLengthMm: number;
  compressionRatio: number;
  /** Included V / main bank angle, degrees. */
  bankAngleDeg: number;
  /** Narrow (VR) angle for W layouts, degrees. */
  vrAngleDeg: number;
  crank: CrankSpec;
  /** Requested firing order (1-based cylinder numbers). Empty = derive from crank. */
  firingOrder: number[];
  valves: ValveSpec;
  cam: CamSpec;
  intake: IntakeSpec;
  exhaust: ExhaustSpec;
  forcedInduction: ForcedInductionSpec;
  calibration: CalibrationSpec;
  /** Vehicle the engine drives in "vehicle" mode. */
  vehicle: VehicleSpec;
  /** Crank + flywheel + driven accessories rotating inertia, kg·m². */
  inertiaKgM2: number;
  /** Cylinder spacing along the crank, mm (bore pitch). */
  borePitchMm: number;
  /** Fuel lower heating value, MJ/kg; stoichiometric AFR. */
  fuelLhvMjKg: number;
  fuelStoichAfr: number;
  /** Seed for every stochastic process (combustion variability, turbulence). */
  seed: number;
}

/** Crank (or eccentric-shaft) degrees per working cycle of one chamber. */
export function cycleDegrees(spec: Pick<EngineSpec, "cycle">): number {
  return spec.cycle === "two-stroke" ? 360 : spec.cycle === "rotary" ? 1080 : 720;
}

/** Swept volume of one Wankel chamber, m³. */
export function rotaryChamberVolume(r: RotarySpec): number {
  return 3 * Math.sqrt(3) * (r.eccentricityMm / 1000) * (r.generatingRadiusMm / 1000) * (r.rotorWidthMm / 1000);
}

/**
 * Litres swept by all working chambers over one cycle each. For rotaries this counts every face
 * (3 × rotors × chamber), which keeps airflow per revolution consistent with the cycle length.
 */
export function displacementLitres(spec: Pick<EngineSpec, "boreMm" | "strokeMm" | "cylinders"> & Partial<Pick<EngineSpec, "rotary">>): number {
  if (spec.rotary) return rotaryChamberVolume(spec.rotary) * spec.cylinders * 1000;
  const bore = spec.boreMm / 1000;
  const stroke = spec.strokeMm / 1000;
  return (Math.PI / 4) * bore * bore * stroke * spec.cylinders * 1000;
}

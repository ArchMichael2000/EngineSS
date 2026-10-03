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
}

export type CollectorStrategy = "bank" | "firing-alternate" | "pairs-then-bank" | "all" | "none";
export type CrossoverType = "none" | "x-pipe" | "h-pipe";
export type MufflerType = "chambered" | "turbo" | "straight-through" | "none";
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
  /** Spark advance at WOT, degrees BTDC, as rpm breakpoints. */
  sparkAdvanceDeg: Array<[rpm: number, advance: number]>;
  /** Lambda at WOT (rich) and part load. */
  lambdaWot: number;
  lambdaPart: number;
  /** Decel fuel cut enabled (DFCO). */
  overrunFuelCut: boolean;
  /** 0 … 1 tendency of the calibration to produce exhaust afterfire on overrun / limiter. */
  afterfireTendency: number;
}

export interface EngineSpec {
  name: string;
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

export function displacementLitres(spec: Pick<EngineSpec, "boreMm" | "strokeMm" | "cylinders">): number {
  const bore = spec.boreMm / 1000;
  const stroke = spec.strokeMm / 1000;
  return (Math.PI / 4) * bore * bore * stroke * spec.cylinders * 1000;
}

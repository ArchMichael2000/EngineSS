/** Engine layout types */
export type EngineLayout = 'inline' | 'v' | 'flat' | 'w' | 'radial';

/** Crankshaft character types */
export type CrankshaftType = 'cross-plane' | 'flat-plane' | 'even-fire' | 'odd-fire';

/** Aspiration types */
export type AspirationType = 'na' | 'turbo' | 'supercharged';

/** Turbo size presets */
export type TurboSize = 'small' | 'balanced' | 'large' | 'custom';

/** Supercharger types */
export type SuperchargerType = 'roots' | 'twin-screw' | 'centrifugal';

/** Exhaust routing types */
export type ExhaustRouting = 'single' | 'dual' | 'open-headers';

/** Header geometry types */
export type HeaderGeometry = 'equal-length' | 'unequal-length';

/** Intake types */
export type IntakeType = 'single-throttle-body' | 'itbs' | 'carb' | 'velocity-stacks' | 'airbox';

/** Rev limiter types */
export type RevLimiterType = 'soft' | 'hard-fuel-cut' | 'hard-ignition-cut';

/** Exhaust character presets */
export type ExhaustCharacter = 'stock' | 'sport' | 'race' | 'straight-pipe';

/** Idle character presets */
export type IdleCharacter = 'smooth' | 'lumpy' | 'aggressive' | 'lopey';

/** Sound model selection for A/B testing and regression control. */
export type SoundProfile =
  | 'v16'
  | 'v15'
  | 'v14'
  | 'v13'
  | 'v12'
  | 'v11'
  | 'v10'
  | 'v9'
  | 'v8'
  | 'v0'
  | 'clarity'
  | 'clean'
  | 'baseline';

export type CanonicalSoundProfile = 'v16' | 'v15' | 'v14' | 'v13' | 'v12' | 'v11' | 'v10' | 'v9' | 'v8' | 'v0';

export const CURRENT_SOUND_PROFILE: CanonicalSoundProfile = 'v16';

/** The last additive (pre-physics) model, kept for A/B comparison and saved configurations. */
export const LEGACY_SOUND_PROFILE: CanonicalSoundProfile = 'v15';

export const SOUND_PROFILE_HISTORY: Array<{
  value: CanonicalSoundProfile;
  label: string;
  description: string;
}> = [
  {
    value: 'v16',
    label: 'v16 - Physical Core',
    description: 'Physics-based engine: thermodynamic cylinders, valve flow into duct waveguides, hot-gas exhaust acoustics, radiation to a placed listener.',
  },
  {
    value: 'v15',
    label: 'v15 - Clean Handoff (legacy)',
    description: 'Last additive model before the physical core; kept for A/B comparison.',
  },
  {
    value: 'v14',
    label: 'v14 - Static Clean',
    description: 'Saved static-clean model with randomized hiss removed from the main engine path.',
  },
  {
    value: 'v13',
    label: 'v13 - Airwash Control',
    description: 'Saved airwash-control model with pressure-gated clarity layers.',
  },
  {
    value: 'v12',
    label: 'v12 - Induction Quality',
    description: 'Saved induction-quality model with reduced airflow wash and more natural turbo/supercharger accessory layers.',
  },
  {
    value: 'v11',
    label: 'v11 - Stereo Stability',
    description: 'Headphone-safe dense-bank stereo and smoother high-RPM output.',
  },
  {
    value: 'v10',
    label: 'v10 - Cylinder Balance',
    description: 'Current ESS model with cylinder loudness compensation and broader control response.',
  },
  {
    value: 'v9',
    label: 'v9 - Saved Best',
    description: 'Saved clarity-output-v9-realtime model before the cylinder balance pass.',
  },
  {
    value: 'v8',
    label: 'v8 - Depth Reference',
    description: 'Filtered depth model kept for comparison.',
  },
  {
    value: 'v0',
    label: 'v0 - Baseline',
    description: 'Original baseline comparison model.',
  },
];

export function normalizeSoundProfile(soundProfile: SoundProfile | undefined): CanonicalSoundProfile {
  if (soundProfile === 'baseline') return 'v0';
  if (soundProfile === 'clean') return 'v8';
  if (soundProfile === 'clarity') return 'v9';
  return soundProfile ?? CURRENT_SOUND_PROFILE;
}

export function isBaselineSoundProfile(soundProfile: SoundProfile | undefined): boolean {
  return normalizeSoundProfile(soundProfile) === 'v0';
}

export function isClaritySoundProfile(soundProfile: SoundProfile | undefined): boolean {
  const normalized = normalizeSoundProfile(soundProfile);
  return normalized === 'v9' || normalized === 'v10' || normalized === 'v11' || normalized === 'v12' || normalized === 'v13' || normalized === 'v14' || normalized === 'v15' || normalized === 'v16';
}

export function isCurrentSoundProfile(soundProfile: SoundProfile | undefined): boolean {
  return normalizeSoundProfile(soundProfile) === CURRENT_SOUND_PROFILE;
}

export function isCylinderBalanceSoundProfile(soundProfile: SoundProfile | undefined): boolean {
  const normalized = normalizeSoundProfile(soundProfile);
  return normalized === 'v10' || normalized === 'v11' || normalized === 'v12' || normalized === 'v13' || normalized === 'v14' || normalized === 'v15' || normalized === 'v16';
}

export function isStereoStabilitySoundProfile(soundProfile: SoundProfile | undefined): boolean {
  const normalized = normalizeSoundProfile(soundProfile);
  return normalized === 'v11' || normalized === 'v12' || normalized === 'v13' || normalized === 'v14' || normalized === 'v15' || normalized === 'v16';
}

export function isAccessoryQualitySoundProfile(soundProfile: SoundProfile | undefined): boolean {
  const normalized = normalizeSoundProfile(soundProfile);
  return normalized === 'v12' || normalized === 'v13' || normalized === 'v14' || normalized === 'v15' || normalized === 'v16';
}

export function isAirwashControlSoundProfile(soundProfile: SoundProfile | undefined): boolean {
  const normalized = normalizeSoundProfile(soundProfile);
  return normalized === 'v13' || normalized === 'v14' || normalized === 'v15' || normalized === 'v16';
}

export function isStaticCleanSoundProfile(soundProfile: SoundProfile | undefined): boolean {
  const normalized = normalizeSoundProfile(soundProfile);
  return normalized === 'v14' || normalized === 'v15' || normalized === 'v16';
}

export function isCleanHandoffSoundProfile(soundProfile: SoundProfile | undefined): boolean {
  // The legacy additive model renders v16 configurations with its latest (v15) behaviour.
  const normalized = normalizeSoundProfile(soundProfile);
  return normalized === 'v15' || normalized === 'v16';
}

/** True when the configuration should run on the v16 physical core. */
export function isPhysicalSoundProfile(soundProfile: SoundProfile | undefined): boolean {
  return normalizeSoundProfile(soundProfile) === 'v16';
}

/** Derived sound-shaping weights learned from reference captures. */
export interface SoundTuningWeights {
  combustionEdge: number;
  exhaustFormantShift: number;
  exhaustBrightness: number;
  orderHarmonicGain: number;
  intakeTexture: number;
  turboWhoosh: number;
  turboTone: number;
  superchargerWhine: number;
  muffling: number;
  clarity: number;
  lowOrderGain: number;
  bodyResonanceGain: number;
  bassShelf: number;
  pulseDensitySmoothing: number;
  spectralTilt: number;
}

/** Compact tuning payload saved with an engine configuration. */
export interface EngineSoundTuning {
  sourceCaptureId?: string;
  analysisId?: string;
  targetId?: string;
  engineFamilyKey: string;
  createdAt: string;
  weights: SoundTuningWeights;
}

export const DEFAULT_SOUND_TUNING_WEIGHTS: SoundTuningWeights = {
  combustionEdge: 1,
  exhaustFormantShift: 1,
  exhaustBrightness: 1,
  orderHarmonicGain: 1,
  intakeTexture: 1,
  turboWhoosh: 1,
  turboTone: 1,
  superchargerWhine: 1,
  muffling: 1,
  clarity: 1,
  lowOrderGain: 1,
  bodyResonanceGain: 1,
  bassShelf: 1,
  pulseDensitySmoothing: 1,
  spectralTilt: 1,
};

/**
 * Quick Build configuration — simplified high-impact controls.
 */
export interface QuickBuildConfig {
  layout: EngineLayout;
  cylinderCount: number;
  displacement: number; // in liters
  crankshaft: CrankshaftType;
  aspiration: AspirationType;
  exhaustCharacter: ExhaustCharacter;
  idleCharacter: IdleCharacter;
  redline: number; // RPM
}

/**
 * Forced induction configuration.
 */
export interface ForcedInductionConfig {
  type: AspirationType;
  // Turbo settings
  turboSize?: TurboSize;
  turboSpoolThreshold?: number; // RPM where boost begins
  maxBoost?: number; // PSI
  bovEnabled?: boolean;
  wastegateEnabled?: boolean;
  // Supercharger settings
  superchargerType?: SuperchargerType;
  superchargerBoost?: number;
  whineIntensity?: number; // 0-1
}

/**
 * Advanced Build configuration — detailed mechanical controls.
 */
export interface AdvancedConfig {
  bore: number; // mm
  stroke: number; // mm
  bankAngle: number; // degrees
  firingOrder: number[];
  headerGeometry: HeaderGeometry;
  exhaustRouting: ExhaustRouting;
  intakeType: IntakeType;
  revLimiterType: RevLimiterType;
  revLimiterRpm: number;
  primaryTubeLengthCm: number;
  exhaustLengthCm: number;
  mufflerVolumeL: number;
  intakeRunnerLengthCm: number;
}

/** Crank strategies understood by the physical core (superset of the Quick Build choices). */
export type PhysicalCrankType = 'even-fire' | 'cross-plane' | 'flat-plane' | 'common-pin' | 'single-pin' | 'custom';
export type CollectorType = 'bank' | 'firing-alternate' | 'pairs-then-bank' | 'all' | 'none';
export type CrossoverPipe = 'none' | 'x-pipe' | 'h-pipe';
export type MufflerKind = 'chambered' | 'turbo' | 'straight-through' | 'none';
export type AirFilterKind = 'oem-paper' | 'cone' | 'sock' | 'none';
export type ListenerPerspective = 'exterior-rear' | 'exterior-side' | 'engine-bay' | 'cabin' | 'dyno-tailpipe';

/**
 * Detailed physical overrides for the v16 core. Every field is optional; anything
 * omitted is filled with family-typical values by resolveEngineSpec().
 */
export interface PhysicalOverrides {
  crankType: PhysicalCrankType;
  /** Throw angle per cylinder, degrees (crankType 'custom'). */
  crankPinAnglesDeg: number[];
  /** Firing TDC per cylinder in the 720° cycle (overrides crank geometry). */
  fireAnglesDeg: number[];
  vrAngleDeg: number;
  rodLengthMm: number;
  compressionRatio: number;
  valvesPerCylinder: 2 | 3 | 4 | 5;
  intakeValveDiameterMm: number;
  exhaustValveDiameterMm: number;
  intakeDurationDeg: number;
  exhaustDurationDeg: number;
  intakeCenterlineDeg: number;
  exhaustCenterlineDeg: number;
  intakeLiftMm: number;
  exhaustLiftMm: number;
  plenumVolumeL: number;
  throttleDiameterMm: number;
  runnerDiameterMm: number;
  airFilter: AirFilterKind;
  primaryDiameterMm: number;
  primaryLengthsMm: number[];
  collector: CollectorType;
  collectorDiameterMm: number;
  pipeDiameterMm: number;
  crossover: CrossoverPipe;
  catalyst: boolean;
  resonator: boolean;
  muffler: MufflerKind;
  mufflerPacking: number;
  tailpipeDiameterMm: number;
  outletSpacingM: number;
  idleRpm: number;
  inertiaKgM2: number;
  afterfireTendency: number;
  /** Harmonic cam-lobe shape exponent γ (engine-sim convention): higher = gentler low-lift ramps, less overlap area. */
  camLobeGamma: number;
  /** Cam phaser authority, crank degrees (0 = fixed): intake advance, exhaust retard. */
  intakePhaserDeg: number;
  exhaustPhaserDeg: number;
  /** Two-step lift switching (VTEC-style): engagement speed and the high-cam lobes. */
  liftSwitchRpm: number;
  highCamIntakeDurationDeg: number;
  highCamExhaustDurationDeg: number;
  highCamIntakeLiftMm: number;
  highCamExhaustLiftMm: number;
  /** Fuel octane (≈ RON) for the knock model. */
  fuelOctane: number;
  /** Closed-loop knock control on/off. */
  knockControl: boolean;
  /** Cylinder-to-cylinder build tolerance 0…1 (production ≈ 0.5). */
  buildTolerance: number;
  turboCount: number;
  compressorWheelMm: number;
  superchargerDisplacementL: number;
  superchargerDriveRatio: number;
}

/** How the engine is listened to (does not change the physics). */
export interface ListenerConfig {
  perspective: ListenerPerspective;
  monitorGainDb: number;
}

/**
 * Full engine configuration combining all settings.
 */
export interface EngineConfiguration {
  // Quick Build params
  quick: QuickBuildConfig;
  // Advanced params (optional, overrides quick defaults)
  advanced?: Partial<AdvancedConfig>;
  // Forced induction
  forcedInduction: ForcedInductionConfig;
  // Sound model
  soundProfile?: SoundProfile;
  // Reference-derived sound shaping
  soundTuning?: EngineSoundTuning;
  // Physical-core overrides (v16)
  physical?: Partial<PhysicalOverrides>;
  // Listener placement (v16)
  listener?: Partial<ListenerConfig>;
  // Runtime state (not saved, used for playback)
  seed?: number; // For deterministic reproduction
}

/**
 * Playback state for the audio engine.
 */
export interface PlaybackState {
  isPlaying: boolean;
  rpm: number;
  throttle: number; // 0-1
  load: number; // 0-1
  targetRpm: number;
  boost: number; // PSI, 0 for NA
  /** v16 only: free-running or dyno-held. */
  driveMode?: 'free' | 'dyno';
  /** v16 only: live physics telemetry from the core. */
  telemetry?: {
    rpm: number;
    mapKpa: number;
    boostKpa: number;
    torqueNm: number;
    brakeTorqueNm: number;
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
    peakPressureAngle: number;
    volumetricEfficiency: number;
    knockRetardDeg: number;
    knockEvents: number;
    intakeCamAdvanceDeg: number;
    exhaustCamRetardDeg: number;
    highCam: boolean;
    splDb: number;
  };
}

/**
 * Default Quick Build configuration.
 */
export const DEFAULT_ENGINE_CONFIG: EngineConfiguration = {
  quick: {
    layout: 'v',
    cylinderCount: 8,
    displacement: 5.0,
    crankshaft: 'cross-plane',
    aspiration: 'na',
    exhaustCharacter: 'sport',
    idleCharacter: 'lumpy',
    redline: 6500,
  },
  forcedInduction: {
    type: 'na',
  },
  soundProfile: CURRENT_SOUND_PROFILE,
};

/**
 * Factory presets for common engine types.
 */
export const FACTORY_PRESETS: Record<string, { name: string; description: string; config: EngineConfiguration }> = {
  'v8-crossplane': {
    name: 'American V8',
    description: 'Classic cross-plane V8 with a deep, burbling exhaust note',
    config: {
      quick: {
        layout: 'v',
        cylinderCount: 8,
        displacement: 5.7,
        crankshaft: 'cross-plane',
        aspiration: 'na',
        exhaustCharacter: 'sport',
        idleCharacter: 'lumpy',
        redline: 6500,
      },
      forcedInduction: { type: 'na' },
    },
  },
  'v8-flatplane': {
    name: 'Flat-Plane V8',
    description: 'High-revving flat-plane V8 with a screaming, even exhaust note',
    config: {
      quick: {
        layout: 'v',
        cylinderCount: 8,
        displacement: 4.0,
        crankshaft: 'flat-plane',
        aspiration: 'na',
        exhaustCharacter: 'race',
        idleCharacter: 'smooth',
        redline: 8500,
      },
      forcedInduction: { type: 'na' },
    },
  },
  'inline-6': {
    name: 'Inline Six',
    description: 'Smooth, naturally balanced inline-6 with a refined exhaust tone',
    config: {
      quick: {
        layout: 'inline',
        cylinderCount: 6,
        displacement: 3.0,
        crankshaft: 'even-fire',
        aspiration: 'na',
        exhaustCharacter: 'sport',
        idleCharacter: 'smooth',
        redline: 7000,
      },
      forcedInduction: { type: 'na' },
    },
  },
  'inline-4-turbo': {
    name: 'Turbo Inline-4',
    description: 'Rally-inspired turbocharged 4-cylinder with spool and BOV',
    config: {
      quick: {
        layout: 'inline',
        cylinderCount: 4,
        displacement: 2.0,
        crankshaft: 'even-fire',
        aspiration: 'turbo',
        exhaustCharacter: 'sport',
        idleCharacter: 'smooth',
        redline: 7500,
      },
      forcedInduction: {
        type: 'turbo',
        turboSize: 'balanced',
        turboSpoolThreshold: 2000,
        maxBoost: 18,
        bovEnabled: true,
        wastegateEnabled: true,
      },
    },
  },
  'v12': {
    name: 'V12 Grand Tourer',
    description: 'Silky smooth V12 with a rich, complex exhaust note',
    config: {
      quick: {
        layout: 'v',
        cylinderCount: 12,
        displacement: 6.5,
        crankshaft: 'even-fire',
        aspiration: 'na',
        exhaustCharacter: 'sport',
        idleCharacter: 'smooth',
        redline: 8000,
      },
      forcedInduction: { type: 'na' },
    },
  },
  'flat-6': {
    name: 'Flat Six',
    description: 'Air-cooled character flat-6 with distinctive boxer rumble',
    config: {
      quick: {
        layout: 'flat',
        cylinderCount: 6,
        displacement: 3.8,
        crankshaft: 'even-fire',
        aspiration: 'na',
        exhaustCharacter: 'sport',
        idleCharacter: 'lumpy',
        redline: 7400,
      },
      forcedInduction: { type: 'na' },
    },
  },
  'v10': {
    name: 'V10 Supercar',
    description: 'High-revving V10 with an exotic, screaming exhaust note',
    config: {
      quick: {
        layout: 'v',
        cylinderCount: 10,
        displacement: 5.2,
        crankshaft: 'flat-plane',
        aspiration: 'na',
        exhaustCharacter: 'race',
        idleCharacter: 'aggressive',
        redline: 8500,
      },
      forcedInduction: { type: 'na' },
    },
  },
  'supercharged-v8': {
    name: 'Supercharged V8',
    description: 'Roots-blown V8 with supercharger whine and massive torque',
    config: {
      quick: {
        layout: 'v',
        cylinderCount: 8,
        displacement: 6.2,
        crankshaft: 'cross-plane',
        aspiration: 'supercharged',
        exhaustCharacter: 'race',
        idleCharacter: 'aggressive',
        redline: 6800,
      },
      forcedInduction: {
        type: 'supercharged',
        superchargerType: 'roots',
        superchargerBoost: 12,
        whineIntensity: 0.7,
      },
    },
  },
};

/**
 * Get default firing order for a given layout and cylinder count.
 */
export function getDefaultFiringOrder(layout: EngineLayout, cylinderCount: number, crankshaft: CrankshaftType): number[] {
  // Common firing orders
  const firingOrders: Record<string, number[]> = {
    'inline-4': [1, 3, 4, 2],
    'inline-6': [1, 5, 3, 6, 2, 4],
    'v-8-cross-plane': [1, 8, 4, 3, 6, 5, 7, 2],
    'v-8-flat-plane': [1, 5, 4, 8, 3, 7, 2, 6],
    'flat-4': [1, 4, 3, 2],
    'flat-6': [1, 6, 2, 4, 3, 5],
    'v-6': [1, 4, 2, 5, 3, 6],
    'v-10': [1, 6, 5, 10, 2, 7, 3, 8, 4, 9],
    'v-12': [1, 7, 5, 11, 3, 9, 6, 12, 2, 8, 4, 10],
  };

  const key = layout === 'v' && cylinderCount === 8
    ? `v-8-${crankshaft === 'cross-plane' ? 'cross-plane' : 'flat-plane'}`
    : `${layout}-${cylinderCount}`;

  if (firingOrders[key]) return firingOrders[key];

  // Generate sequential firing order as fallback
  return Array.from({ length: cylinderCount }, (_, i) => i + 1);
}

/**
 * Validate a firing order for a given cylinder count.
 */
export function validateFiringOrder(firingOrder: number[], cylinderCount: number): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (firingOrder.length !== cylinderCount) {
    errors.push(`Firing order must have exactly ${cylinderCount} entries, got ${firingOrder.length}`);
  }

  const seen = new Set<number>();
  for (const cyl of firingOrder) {
    if (cyl < 1 || cyl > cylinderCount) {
      errors.push(`Cylinder ${cyl} is out of range (1-${cylinderCount})`);
    }
    if (seen.has(cyl)) {
      errors.push(`Cylinder ${cyl} appears more than once`);
    }
    seen.add(cyl);
  }

  for (let i = 1; i <= cylinderCount; i++) {
    if (!seen.has(i)) {
      errors.push(`Cylinder ${i} is missing from the firing order`);
    }
  }

  return { valid: errors.length === 0, errors };
}

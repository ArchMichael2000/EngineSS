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
  /** Fuel / combustion system (default gasoline spark ignition). */
  fuel?: FuelType;
  /** Working cycle (default four-stroke). Rotary: cylinderCount = rotors, displacement = rotors × chamber. */
  cycle?: EngineCycleType;
}

export type FuelType = 'gasoline' | 'diesel';
export type EngineCycleType = 'four-stroke' | 'two-stroke' | 'rotary';

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
export type MufflerKind = 'chambered' | 'turbo' | 'straight-through' | 'glasspack' | 'none';
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
  /** Diesel: start of main injection at rated speed, degrees BTDC. */
  injectionAdvanceDeg: number;
  /** Diesel: common-rail pilot injection (shortens the main ignition delay, softens clatter). */
  pilotInjection: boolean;
  /** Diesel fuel cetane number (EN 590 ≥ 51, US #2 ≈ 40–45). */
  cetaneNumber: number;
  /** Two-stroke port timings (degrees ATDC the piston uncovers the port), widths and crankcase. */
  exhaustPortOpenDeg: number;
  transferPortOpenDeg: number;
  exhaustPortWidthRatio: number;
  transferPortWidthRatio: number;
  crankcaseCompressionRatio: number;
  twoStrokeIntake: 'reed' | 'piston-port';
  scavengeQuality: number;
  expansionChamber: boolean;
  expansionChamberTunedRpm: number;
  /** Rotary: porting (exhaust peripheral/side, intake side/peripheral) and port events in e-shaft degrees of a face's 1080° cycle. */
  rotaryExhaustPort: 'peripheral' | 'side';
  rotaryIntakePort: 'side' | 'peripheral';
  rotaryIntakeOpenDeg: number;
  rotaryIntakeCloseDeg: number;
  rotaryExhaustOpenDeg: number;
  rotaryExhaustCloseDeg: number;
  /** Diesel full-load fuel per cylinder per cycle, mg (pump fuel-plate / calibration limit; default: smoke limit at rated boost). */
  dieselFullLoadFuelMg: number;
  /** Cylinder-to-cylinder build tolerance 0…1 (production ≈ 0.5). */
  buildTolerance: number;
  /** Intake snorkel Helmholtz resonator tuned frequency (Hz, 0 = none) and cavity volume (L). */
  intakeResonatorHz: number;
  intakeResonatorVolumeL: number;
  /** Quarter-wave "J-pipe" drone tube tuned to this frequency, Hz (0 = none). */
  droneTubeHz: number;
  /** Helmholtz resonator tuned frequency (Hz) and cavity volume (L). */
  helmholtzHz: number;
  helmholtzVolumeL: number;
  /** Valved exhaust: bypass opening speed (auto mode) and mode. */
  exhaustValveOpenRpm: number;
  exhaustValveMode: 'auto' | 'open' | 'closed' | 'none';
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
  driveMode?: 'free' | 'dyno' | 'vehicle';
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
    exhaustValve: number;
    engineState: 'running' | 'cranking' | 'off';
    gear: number;
    speedKmh: number;
    clutch: number;
    shifting: boolean;
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

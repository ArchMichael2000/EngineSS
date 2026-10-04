/**
 * Sound-profile versions of the legacy (v0–v15) additive model. The shipped app runs only
 * the v16 physical core; these helpers keep the legacy model's behaviour identical for its
 * tests and A/B renders. An unset profile normalises to v16, which the legacy model renders
 * with its latest (v15) behaviour.
 */
import type { CanonicalSoundProfile, SoundProfile } from "../shared/engineTypes";
import { CURRENT_SOUND_PROFILE } from "../shared/engineTypes";

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

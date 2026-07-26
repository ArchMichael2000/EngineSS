import type { EngineConfiguration, SoundProfile } from "./engineTypes";
import { isBaselineSoundProfile, isClaritySoundProfile, isCylinderBalanceSoundProfile, normalizeSoundProfile } from "./engineTypes";

export interface RealtimeAudioMixProfile {
  dryExhaustGain: number;
  filteredExhaustGain: number;
  filteredIntakeGain: number;
  compressorThresholdDb: number;
  compressorKneeDb: number;
  compressorRatio: number;
  compressorAttackSec: number;
  compressorReleaseSec: number;
  legacyForcedInductionOscillatorGain: number;
}

export function resolveRealtimeAudioMixProfile(soundProfile: SoundProfile | undefined): RealtimeAudioMixProfile {
  const normalized = normalizeSoundProfile(soundProfile);

  if (isClaritySoundProfile(normalized)) {
    return {
      dryExhaustGain: 0.98,
      filteredExhaustGain: 0,
      filteredIntakeGain: 0,
      compressorThresholdDb: -0.8,
      compressorKneeDb: 4,
      compressorRatio: 1.08,
      compressorAttackSec: 0.018,
      compressorReleaseSec: 0.045,
      legacyForcedInductionOscillatorGain: 0,
    };
  }

  if (normalized === "v8") {
    return {
      dryExhaustGain: 0.06,
      filteredExhaustGain: 0.74,
      filteredIntakeGain: 0.26,
      compressorThresholdDb: -7,
      compressorKneeDb: 18,
      compressorRatio: 2.4,
      compressorAttackSec: 0.0012,
      compressorReleaseSec: 0.09,
      legacyForcedInductionOscillatorGain: 1,
    };
  }

  return {
    dryExhaustGain: 0,
    filteredExhaustGain: 0.74,
    filteredIntakeGain: 0.26,
    compressorThresholdDb: -7,
    compressorKneeDb: 18,
    compressorRatio: 2.4,
    compressorAttackSec: 0.0012,
    compressorReleaseSec: 0.09,
    legacyForcedInductionOscillatorGain: 1,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function resolveLiveOutputGain(config: EngineConfiguration): number {
  const { quick, forcedInduction } = config;
  const displacement = Math.max(0.6, quick.displacement);
  const cylinderCount = Math.max(1, quick.cylinderCount);
  const normalized = normalizeSoundProfile(config.soundProfile);
  const displacementLift = clamp(0.94 + Math.sqrt(displacement / 5.0) * 0.070, 0.96, 1.12);
  const smoothEngineLift = cylinderCount <= 4 ? 1.14 : cylinderCount <= 6 ? 1.10 : cylinderCount <= 8 ? 1.04 : cylinderCount <= 12 ? 1.08 : 1.06;
  const currentLift = isCylinderBalanceSoundProfile(normalized) ? normalized === "v15" ? 1.10 : 1.08 : 1;
  const exhaustTrim = quick.exhaustCharacter === "stock" ? 1.08 : quick.exhaustCharacter === "sport" ? 1.03 : quick.exhaustCharacter === "race" ? 0.96 : 0.92;
  const inductionTrim = forcedInduction.type === "turbo" ? 1.04 : forcedInduction.type === "supercharged" ? 0.98 : 1;
  const profileTrim = isClaritySoundProfile(normalized) ? 1.03 : isBaselineSoundProfile(normalized) ? 0.96 : 1;

  return clamp(0.68 * displacementLift * smoothEngineLift * currentLift * exhaustTrim * inductionTrim * profileTrim, 0.60, 1.04);
}

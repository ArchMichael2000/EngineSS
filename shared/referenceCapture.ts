import type { EngineConfiguration } from "./engineTypes";
import type { CaptureAnalysisSummary, TuningTarget } from "./audioAnalysis";

export type CaptureSegmentType =
  | "cold-start"
  | "hot-start"
  | "idle"
  | "steady-rpm"
  | "rpm-sweep"
  | "acceleration"
  | "deceleration"
  | "shift";

export type CapturePerspective =
  | "tailpipe"
  | "engine-bay"
  | "intake"
  | "cabin"
  | "exterior"
  | "mixed";

export interface ReferenceCaptureSegment {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number;
  createdAt: string;
  segmentType: CaptureSegmentType;
  perspective: CapturePerspective;
  rpmStart: number;
  rpmEnd: number;
  load: number;
  throttle: number;
  micDistanceCm?: number;
  notes?: string;
  engineConfig?: EngineConfiguration;
  analysisSummary?: CaptureAnalysisSummary;
  tuningTarget?: TuningTarget;
}

export interface CaptureValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export const CAPTURE_SEGMENT_TYPES: Array<{ value: CaptureSegmentType; label: string }> = [
  { value: "cold-start", label: "Cold Start" },
  { value: "hot-start", label: "Hot Start" },
  { value: "idle", label: "Idle" },
  { value: "steady-rpm", label: "Steady RPM" },
  { value: "rpm-sweep", label: "RPM Sweep" },
  { value: "acceleration", label: "Acceleration" },
  { value: "deceleration", label: "Deceleration" },
  { value: "shift", label: "Shift" },
];

export const CAPTURE_PERSPECTIVES: Array<{ value: CapturePerspective; label: string }> = [
  { value: "tailpipe", label: "Tailpipe" },
  { value: "engine-bay", label: "Engine Bay" },
  { value: "intake", label: "Intake" },
  { value: "cabin", label: "Cabin" },
  { value: "exterior", label: "Exterior" },
  { value: "mixed", label: "Mixed" },
];

export function createCaptureId(fileName: string, createdAt = new Date()): string {
  const base = `${createdAt.getTime()}-${fileName}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return base.replace(/^-|-$/g, "").slice(0, 96);
}

export function validateReferenceCapture(segment: ReferenceCaptureSegment): CaptureValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!segment.name.trim()) errors.push("Capture name is required.");
  if (!segment.fileName.trim()) errors.push("Audio file name is required.");
  if (segment.durationSec <= 0) errors.push("Capture duration must be greater than zero.");
  if (segment.rpmStart < 0 || segment.rpmEnd < 0) errors.push("RPM values cannot be negative.");
  if (segment.rpmEnd < segment.rpmStart && segment.segmentType !== "deceleration") {
    warnings.push("Ending RPM is lower than starting RPM.");
  }
  if (segment.durationSec < 2 && segment.segmentType !== "shift") {
    warnings.push("Short captures are hard to loop cleanly.");
  }
  if (segment.segmentType === "steady-rpm" && Math.abs(segment.rpmEnd - segment.rpmStart) > 250) {
    warnings.push("Steady RPM captures should stay close to one RPM band.");
  }
  if (segment.segmentType === "rpm-sweep" && Math.abs(segment.rpmEnd - segment.rpmStart) < 1000) {
    warnings.push("RPM sweeps need a wide RPM range to train useful interpolation.");
  }
  if (segment.load < 0 || segment.load > 1) errors.push("Load must be between 0 and 1.");
  if (segment.throttle < 0 || segment.throttle > 1) errors.push("Throttle must be between 0 and 1.");

  return { valid: errors.length === 0, warnings, errors };
}

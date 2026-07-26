import { describe, expect, it } from "vitest";
import { createCaptureId, validateReferenceCapture, type ReferenceCaptureSegment } from "./referenceCapture";

function createSegment(overrides: Partial<ReferenceCaptureSegment> = {}): ReferenceCaptureSegment {
  return {
    id: "capture-1",
    name: "V8 sweep",
    fileName: "v8-sweep.wav",
    mimeType: "audio/wav",
    sizeBytes: 1024,
    durationSec: 12,
    createdAt: new Date("2026-07-24T00:00:00Z").toISOString(),
    segmentType: "rpm-sweep",
    perspective: "tailpipe",
    rpmStart: 900,
    rpmEnd: 6500,
    load: 0.45,
    throttle: 0.85,
    ...overrides,
  };
}

describe("reference capture validation", () => {
  it("accepts a complete capture segment", () => {
    const result = validateReferenceCapture(createSegment());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects invalid levels and missing names", () => {
    const result = validateReferenceCapture(createSegment({ name: "", load: 1.2, throttle: -0.1 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Capture name is required.");
    expect(result.errors).toContain("Load must be between 0 and 1.");
    expect(result.errors).toContain("Throttle must be between 0 and 1.");
  });

  it("warns when steady RPM captures wander too much", () => {
    const result = validateReferenceCapture(createSegment({
      segmentType: "steady-rpm",
      rpmStart: 2500,
      rpmEnd: 3100,
    }));
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain("Steady RPM captures should stay close to one RPM band.");
  });

  it("warns when sweeps do not cover enough RPM range", () => {
    const result = validateReferenceCapture(createSegment({
      segmentType: "rpm-sweep",
      rpmStart: 2500,
      rpmEnd: 3100,
    }));
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain("RPM sweeps need a wide RPM range to train useful interpolation.");
  });

  it("creates stable filesystem-safe ids", () => {
    const id = createCaptureId("My Engine Pull #1.wav", new Date("2026-07-24T00:00:00Z"));
    expect(id).toBe("1784851200000-my-engine-pull-1-wav");
  });
});

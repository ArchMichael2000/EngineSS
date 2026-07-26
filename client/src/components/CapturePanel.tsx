import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Activity, CheckCircle2, Download, FileAudio2, Play, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import type { EngineConfiguration, EngineSoundTuning } from "../../../shared/engineTypes";
import type { CapturePerspective, CaptureSegmentType, ReferenceCaptureSegment } from "../../../shared/referenceCapture";
import { CAPTURE_PERSPECTIVES, CAPTURE_SEGMENT_TYPES, validateReferenceCapture } from "../../../shared/referenceCapture";
import { analyzeReferenceCapture } from "@/lib/captureAnalysis";
import {
  deleteReferenceCapture,
  getReferenceCaptureBlob,
  listReferenceCaptures,
  saveCaptureAnalysis,
  saveReferenceCapture,
  subscribeToCaptureLibrary,
} from "@/lib/captureLibrary";

interface CapturePanelProps {
  config: EngineConfiguration;
  onApplyTuning?: (config: EngineConfiguration) => void;
}

const segmentDefaults: Record<CaptureSegmentType, { rpmStart: number; rpmEnd: number; throttle: number; load: number }> = {
  "cold-start": { rpmStart: 0, rpmEnd: 1400, throttle: 0.08, load: 0.12 },
  "hot-start": { rpmStart: 0, rpmEnd: 1100, throttle: 0.06, load: 0.10 },
  idle: { rpmStart: 750, rpmEnd: 950, throttle: 0.04, load: 0.12 },
  "steady-rpm": { rpmStart: 2500, rpmEnd: 2500, throttle: 0.25, load: 0.35 },
  "rpm-sweep": { rpmStart: 900, rpmEnd: 6500, throttle: 0.85, load: 0.45 },
  acceleration: { rpmStart: 1400, rpmEnd: 6500, throttle: 1, load: 0.85 },
  deceleration: { rpmStart: 5500, rpmEnd: 1200, throttle: 0, load: 0.25 },
  shift: { rpmStart: 4500, rpmEnd: 3200, throttle: 0.2, load: 0.45 },
};

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remaining}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatHz(hz: number) {
  if (!Number.isFinite(hz) || hz <= 0) return "0 Hz";
  if (hz >= 1000) return `${(hz / 1000).toFixed(1)} kHz`;
  return `${Math.round(hz)} Hz`;
}

function compactWeightSummary(tuning?: EngineSoundTuning["weights"]) {
  if (!tuning) return null;
  return `edge ${tuning.combustionEdge.toFixed(2)} | bright ${tuning.exhaustBrightness.toFixed(2)} | clear ${tuning.clarity.toFixed(2)}`;
}

export function CapturePanel({ config, onApplyTuning }: CapturePanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [captures, setCaptures] = useState<ReferenceCaptureSegment[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    name: "",
    segmentType: "rpm-sweep" as CaptureSegmentType,
    perspective: "tailpipe" as CapturePerspective,
    rpmStart: 900,
    rpmEnd: config.quick.redline,
    load: 0.45,
    throttle: 0.85,
    micDistanceCm: 75,
    notes: "",
  });

  const refresh = useCallback(async () => {
    setCaptures(await listReferenceCaptures());
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeToCaptureLibrary(() => void refresh());
  }, [refresh]);

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      rpmEnd: current.segmentType === "rpm-sweep" || current.segmentType === "acceleration"
        ? config.quick.redline
        : current.rpmEnd,
    }));
  }, [config.quick.redline]);

  const validationWarnings = useMemo(() => {
    if (!file) return [];
    const segment: ReferenceCaptureSegment = {
      id: "draft",
      name: draft.name || file.name,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      durationSec: 10,
      createdAt: new Date().toISOString(),
      segmentType: draft.segmentType,
      perspective: draft.perspective,
      rpmStart: draft.rpmStart,
      rpmEnd: draft.rpmEnd,
      load: draft.load,
      throttle: draft.throttle,
      micDistanceCm: draft.micDistanceCm,
      notes: draft.notes,
      engineConfig: config,
    };
    return validateReferenceCapture(segment).warnings;
  }, [config, draft, file]);

  const setSegmentType = (segmentType: CaptureSegmentType) => {
    const defaults = segmentDefaults[segmentType];
    setDraft((current) => ({
      ...current,
      segmentType,
      rpmStart: defaults.rpmStart,
      rpmEnd: segmentType === "rpm-sweep" || segmentType === "acceleration" ? config.quick.redline : defaults.rpmEnd,
      throttle: defaults.throttle,
      load: defaults.load,
    }));
  };

  const handleSave = async () => {
    if (!file) {
      toast.error("Select an audio recording first.");
      return;
    }

    setIsSaving(true);
    try {
      await saveReferenceCapture(file, { ...draft, engineConfig: config });
      setFile(null);
      setDraft((current) => ({ ...current, name: "", notes: "" }));
      toast.success("Reference capture saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save capture.");
    } finally {
      setIsSaving(false);
    }
  };

  const handlePreview = async (id: string) => {
    const blob = await getReferenceCaptureBlob(id);
    if (!blob) {
      toast.error("Capture file is missing.");
      return;
    }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      toast.error("Unable to preview this capture.");
    };
    await audio.play();
  };

  const handleAnalyze = async (capture: ReferenceCaptureSegment) => {
    setAnalyzingId(capture.id);
    try {
      const blob = await getReferenceCaptureBlob(capture.id);
      if (!blob) {
        toast.error("Capture file is missing.");
        return;
      }

      const analysis = await analyzeReferenceCapture(blob, capture, {
        engineConfig: capture.engineConfig ?? config,
        useEssentia: true,
      });
      await saveCaptureAnalysis(capture.id, analysis);
      await refresh();
      toast.success("Capture analyzed and tuning target created.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to analyze capture.");
    } finally {
      setAnalyzingId(null);
    }
  };

  const handleApplyTuning = async (capture: ReferenceCaptureSegment) => {
    if (!capture.tuningTarget) {
      toast.error("Analyze this capture before applying it.");
      return;
    }

    setApplyingId(capture.id);
    try {
      const tuning: EngineSoundTuning = {
        sourceCaptureId: capture.tuningTarget.captureId,
        analysisId: capture.tuningTarget.analysisId,
        targetId: capture.tuningTarget.id,
        engineFamilyKey: capture.tuningTarget.engineFamilyKey,
        createdAt: capture.tuningTarget.createdAt,
        weights: capture.tuningTarget.weights,
      };
      onApplyTuning?.({ ...config, soundTuning: tuning });
      toast.success("Tuning target applied to current engine.");
    } finally {
      setApplyingId(null);
    }
  };

  const handleExportMetadata = () => {
    const blob = new Blob([JSON.stringify(captures, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ess-reference-captures-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-sm font-semibold font-[Orbitron] text-neon-cyan glow-cyan uppercase tracking-wider">
          Capture
        </h3>
        <div className="flex-1 h-px bg-gradient-to-r from-neon-cyan/40 to-transparent" />
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">
          Audio File
        </Label>
        <Input
          type="file"
          accept="audio/*"
          onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
          className="text-xs"
        />
        {file && (
          <div className="flex items-center gap-2 text-[10px] font-[JetBrains_Mono] text-muted-foreground">
            <FileAudio2 className="w-3 h-3 text-neon-cyan" />
            {file.name} | {formatBytes(file.size)}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">
            Segment
          </Label>
          <Select value={draft.segmentType} onValueChange={(value) => setSegmentType(value as CaptureSegmentType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CAPTURE_SEGMENT_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">
            Perspective
          </Label>
          <Select value={draft.perspective} onValueChange={(value) => setDraft((current) => ({ ...current, perspective: value as CapturePerspective }))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CAPTURE_PERSPECTIVES.map((perspective) => (
                <SelectItem key={perspective.value} value={perspective.value}>
                  {perspective.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Input
        value={draft.name}
        onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
        placeholder="Capture name"
        className="h-8 text-xs"
      />

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">
              Start RPM
            </Label>
            <span className="text-xs font-[Orbitron] text-neon-cyan">{draft.rpmStart}</span>
          </div>
          <Slider
            value={[draft.rpmStart]}
            onValueChange={([rpmStart]) => setDraft((current) => ({ ...current, rpmStart }))}
            min={0}
            max={config.quick.redline}
            step={50}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">
              End RPM
            </Label>
            <span className="text-xs font-[Orbitron] text-neon-cyan">{draft.rpmEnd}</span>
          </div>
          <Slider
            value={[draft.rpmEnd]}
            onValueChange={([rpmEnd]) => setDraft((current) => ({ ...current, rpmEnd }))}
            min={0}
            max={config.quick.redline}
            step={50}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">
              Throttle
            </Label>
            <span className="text-xs font-[Orbitron] text-neon-pink">{Math.round(draft.throttle * 100)}%</span>
          </div>
          <Slider
            value={[draft.throttle * 100]}
            onValueChange={([throttle]) => setDraft((current) => ({ ...current, throttle: throttle / 100 }))}
            min={0}
            max={100}
            step={5}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">
              Load
            </Label>
            <span className="text-xs font-[Orbitron] text-neon-purple">{Math.round(draft.load * 100)}%</span>
          </div>
          <Slider
            value={[draft.load * 100]}
            onValueChange={([load]) => setDraft((current) => ({ ...current, load: load / 100 }))}
            min={0}
            max={100}
            step={5}
          />
        </div>
      </div>

      {validationWarnings.length > 0 && (
        <div className="space-y-1 text-[10px] font-[Rajdhani] text-neon-pink">
          {validationWarnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        disabled={isSaving}
        onClick={handleSave}
        className="w-full text-xs font-[Rajdhani] border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/10"
      >
        <Upload className="w-3.5 h-3.5 mr-1.5" />
        Save Capture
      </Button>

      <div className="pt-2 border-t border-hud-line/20 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-[Rajdhani] text-muted-foreground uppercase tracking-wide">
            Library
          </h4>
          <Button
            variant="ghost"
            size="sm"
            disabled={captures.length === 0}
            onClick={handleExportMetadata}
            className="h-7 px-2 text-[10px] text-muted-foreground hover:text-neon-cyan"
          >
            <Download className="w-3 h-3 mr-1" />
            JSON
          </Button>
        </div>

        {captures.length === 0 ? (
          <p className="text-xs font-[Rajdhani] text-muted-foreground">No captures saved.</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {captures.map((capture) => {
              const summary = capture.analysisSummary;
              const tuningSummary = compactWeightSummary(capture.tuningTarget?.weights);
              const isAnalyzing = analyzingId === capture.id;
              const isApplying = applyingId === capture.id;

              return (
                <div key={capture.id} className="rounded border border-hud-line/30 bg-dark-bg/40 p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-[Orbitron] text-foreground">{capture.name}</div>
                      <div className="text-[10px] font-[JetBrains_Mono] text-muted-foreground">
                        {capture.segmentType} | {capture.perspective} | {Math.round(capture.rpmStart)}-{Math.round(capture.rpmEnd)} rpm
                      </div>
                      <div className="text-[10px] font-[Rajdhani] text-muted-foreground">
                        {formatDuration(capture.durationSec)} | {formatBytes(capture.sizeBytes)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handlePreview(capture.id)}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-neon-cyan"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          await deleteReferenceCapture(capture.id);
                          toast.success("Capture deleted.");
                        }}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  {summary && (
                    <div className="mt-2 rounded border border-neon-cyan/20 bg-neon-cyan/5 px-2 py-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] font-[Rajdhani] text-neon-cyan">
                        <Activity className="h-3 w-3" />
                        {formatHz(summary.spectralCentroidMean)} centroid | flat {summary.spectralFlatnessMean.toFixed(2)} | trans {summary.transientDensity.toFixed(2)}
                      </div>
                      {tuningSummary && (
                        <div className="mt-0.5 text-[10px] font-[JetBrains_Mono] text-muted-foreground">
                          {tuningSummary}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isAnalyzing}
                      onClick={() => void handleAnalyze(capture)}
                      className="h-7 px-2 text-[10px] font-[Rajdhani] border-neon-cyan/30 text-neon-cyan hover:bg-neon-cyan/10"
                    >
                      <SlidersHorizontal className="w-3 h-3 mr-1" />
                      {isAnalyzing ? "Analyzing" : "Analyze"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!capture.tuningTarget || isApplying || !onApplyTuning}
                      onClick={() => void handleApplyTuning(capture)}
                      className="h-7 px-2 text-[10px] font-[Rajdhani] border-neon-pink/30 text-neon-pink hover:bg-neon-pink/10 disabled:text-muted-foreground"
                    >
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      {isApplying ? "Applying" : "Apply"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

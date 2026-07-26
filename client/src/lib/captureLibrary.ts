import type { EngineConfiguration } from "../../../shared/engineTypes";
import type { CaptureAnalysis, TuningTarget } from "../../../shared/audioAnalysis";
import { deriveTuningTargetFromAnalysis } from "../../../shared/audioAnalysis";
import type {
  CapturePerspective,
  CaptureSegmentType,
  ReferenceCaptureSegment,
} from "../../../shared/referenceCapture";
import { createCaptureId, validateReferenceCapture } from "../../../shared/referenceCapture";

const DB_NAME = "ess-reference-captures";
const DB_VERSION = 2;
const STORE_NAME = "segments";
const EVENT_NAME = "ess:capture-library";

export interface StoredCapture {
  segment: ReferenceCaptureSegment;
  blob: Blob;
  analysis?: CaptureAnalysis;
  tuningTarget?: TuningTarget;
}

export interface CaptureDraft {
  name: string;
  segmentType: CaptureSegmentType;
  perspective: CapturePerspective;
  rpmStart: number;
  rpmEnd: number;
  load: number;
  throttle: number;
  micDistanceCm?: number;
  notes?: string;
  engineConfig?: EngineConfiguration;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "segment.id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open capture library."));
  });
}

function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Capture library request failed."));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Capture library transaction failed."));
    };
  }));
}

function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();

    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to read audio metadata from this file."));
    };
    audio.src = url;
  });
}

export async function saveReferenceCapture(file: File, draft: CaptureDraft): Promise<ReferenceCaptureSegment> {
  const durationSec = await readAudioDuration(file);
  const createdAt = new Date();
  const segment: ReferenceCaptureSegment = {
    id: createCaptureId(file.name, createdAt),
    name: draft.name.trim() || file.name.replace(/\.[^.]+$/, ""),
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    durationSec,
    createdAt: createdAt.toISOString(),
    segmentType: draft.segmentType,
    perspective: draft.perspective,
    rpmStart: draft.rpmStart,
    rpmEnd: draft.rpmEnd,
    load: draft.load,
    throttle: draft.throttle,
    micDistanceCm: draft.micDistanceCm,
    notes: draft.notes?.trim() || undefined,
    engineConfig: draft.engineConfig,
  };

  const validation = validateReferenceCapture(segment);
  if (!validation.valid) {
    throw new Error(validation.errors[0]);
  }

  await withStore(segment.id ? "readwrite" : "readonly", (store) => store.put({ segment, blob: file }));
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
  return segment;
}

export async function listReferenceCaptures(): Promise<ReferenceCaptureSegment[]> {
  const captures = await withStore<StoredCapture[]>("readonly", (store) => store.getAll());
  return captures
    .map((capture) => capture.segment)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getReferenceCaptureBlob(id: string): Promise<Blob | null> {
  const capture = await withStore<StoredCapture | undefined>("readonly", (store) => store.get(id));
  return capture?.blob ?? null;
}

export async function getStoredCapture(id: string): Promise<StoredCapture | null> {
  const capture = await withStore<StoredCapture | undefined>("readonly", (store) => store.get(id));
  return capture ?? null;
}

export async function getCaptureAnalysis(id: string): Promise<CaptureAnalysis | null> {
  const capture = await getStoredCapture(id);
  return capture?.analysis ?? null;
}

export async function saveCaptureAnalysis(captureId: string, analysis: CaptureAnalysis): Promise<TuningTarget> {
  const existing = await getStoredCapture(captureId);
  if (!existing) {
    throw new Error("Capture file is missing.");
  }

  const tuningTarget = deriveTuningTargetFromAnalysis(analysis);
  const updated: StoredCapture = {
    ...existing,
    analysis,
    tuningTarget,
    segment: {
      ...existing.segment,
      analysisSummary: analysis.summary,
      tuningTarget,
    },
  };

  await withStore("readwrite", (store) => store.put(updated));
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
  return tuningTarget;
}

export async function listTuningTargets(): Promise<TuningTarget[]> {
  const captures = await withStore<StoredCapture[]>("readonly", (store) => store.getAll());
  return captures
    .map((capture) => capture.tuningTarget ?? capture.segment.tuningTarget)
    .filter((target): target is TuningTarget => Boolean(target));
}

export async function deleteReferenceCapture(id: string): Promise<void> {
  await withStore<undefined>("readwrite", (store) => store.delete(id) as IDBRequest<undefined>);
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function subscribeToCaptureLibrary(listener: () => void): () => void {
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}

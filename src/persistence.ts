import {
  parseScoreDocument,
  serializeScore,
  type Score,
  type ScoreDocumentError,
} from "./domain";

export const SCORE_DRAFT_STORAGE_KEY = "jianpu-editor.current-score";
export const AUTOSAVE_DELAY_MS = 500;

export type SaveStatus = "saving" | "saved" | "failed";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type DraftRestoreResult =
  | { readonly kind: "empty" }
  | { readonly kind: "restored"; readonly score: Score }
  | {
      readonly kind: "invalid";
      readonly error: ScoreDocumentError;
      readonly raw: string;
    }
  | { readonly kind: "unavailable"; readonly error: unknown };

export interface SaveStatusEvent {
  readonly status: SaveStatus;
  readonly score?: Score;
  readonly error?: unknown;
}

export interface TimerScheduler {
  set(callback: () => void, delay: number): unknown;
  clear(handle: unknown): void;
}

export const browserStorage: StorageLike = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};

const browserTimerScheduler: TimerScheduler = {
  set: (callback, delay) => window.setTimeout(callback, delay),
  clear: (handle) => window.clearTimeout(handle as number),
};

export function restoreDraft(
  storage: StorageLike,
  key = SCORE_DRAFT_STORAGE_KEY,
): DraftRestoreResult {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch (error) {
    return { kind: "unavailable", error };
  }

  if (raw === null) {
    return { kind: "empty" };
  }

  const parsed = parseScoreDocument(raw);
  if (!parsed.ok) {
    return { kind: "invalid", error: parsed.error, raw };
  }

  const normalized = serializeScore(parsed.value.score);
  if (normalized !== raw) {
    try {
      storage.setItem(key, normalized);
    } catch {
      // A valid draft remains usable even when the compatibility cleanup cannot persist.
    }
  }

  return { kind: "restored", score: parsed.value.score };
}

export function saveDraft(
  storage: StorageLike,
  score: Score,
  key = SCORE_DRAFT_STORAGE_KEY,
): void {
  storage.setItem(key, serializeScore(score));
}

export class DebouncedDraftSaver {
  private timer: unknown;
  private revision = 0;

  constructor(
    private readonly storage: StorageLike,
    private readonly onStatus: (event: SaveStatusEvent) => void,
    private readonly delay = AUTOSAVE_DELAY_MS,
    private readonly scheduler: TimerScheduler = browserTimerScheduler,
    private readonly key = SCORE_DRAFT_STORAGE_KEY,
  ) {}

  schedule(score: Score): void {
    const revision = this.beginSave();
    this.onStatus({ status: "saving" });
    this.timer = this.scheduler.set(() => {
      this.timer = undefined;
      this.persist(score, revision);
    }, this.delay);
  }

  saveNow(score: Score): boolean {
    const revision = this.beginSave();
    this.onStatus({ status: "saving" });
    return this.persist(score, revision);
  }

  dispose(): void {
    this.revision += 1;
    this.clearTimer();
  }

  private beginSave(): number {
    this.revision += 1;
    this.clearTimer();
    return this.revision;
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      this.scheduler.clear(this.timer);
      this.timer = undefined;
    }
  }

  private persist(score: Score, revision: number): boolean {
    try {
      saveDraft(this.storage, score, this.key);
      if (revision === this.revision) {
        this.onStatus({ status: "saved", score });
      }
      return true;
    } catch (error) {
      if (revision === this.revision) {
        this.onStatus({ status: "failed", error });
      }
      return false;
    }
  }
}

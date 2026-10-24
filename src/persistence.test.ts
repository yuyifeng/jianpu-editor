import { describe, expect, it } from "vitest";

import {
  createEmptyScore,
  createSequentialIdFactory,
  serializeScore,
  type Score,
} from "./domain";
import {
  DebouncedDraftSaver,
  SCORE_DRAFT_STORAGE_KEY,
  restoreDraft,
  saveDraft,
  type SaveStatusEvent,
  type StorageLike,
  type TimerScheduler,
} from "./persistence";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  setCalls = 0;
  failReads = false;
  failWrites = false;

  getItem(key: string): string | null {
    if (this.failReads) {
      throw new Error("storage read denied");
    }
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.setCalls += 1;
    if (this.failWrites) {
      throw new Error("quota exceeded");
    }
    this.values.set(key, value);
  }
}

class ManualScheduler implements TimerScheduler {
  private nextId = 0;
  private readonly callbacks = new Map<number, () => void>();

  set(callback: () => void): number {
    this.nextId += 1;
    this.callbacks.set(this.nextId, callback);
    return this.nextId;
  }

  clear(handle: unknown): void {
    this.callbacks.delete(handle as number);
  }

  flush(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((callback) => callback());
  }

  get size(): number {
    return this.callbacks.size;
  }
}

function titledScore(title: string): Score {
  return {
    ...createEmptyScore(createSequentialIdFactory(title)),
    title,
  };
}

describe("draft persistence", () => {
  it("restores a valid versioned draft", () => {
    const storage = new MemoryStorage();
    const score = titledScore("已保存");
    storage.values.set(SCORE_DRAFT_STORAGE_KEY, serializeScore(score));

    expect(restoreDraft(storage)).toEqual({ kind: "restored", score });
  });

  it("removes legacy author and lyric fields while restoring a valid draft", () => {
    const storage = new MemoryStorage();
    const score = titledScore("旧草稿");
    const legacy = JSON.stringify({
      format: "jianpu-editor",
      version: 1,
      score: {
        ...score,
        author: "旧作者",
        measures: [
          {
            ...score.measures[0],
            symbols: [
              {
                id: "legacy-note",
                kind: "note",
                degree: 1,
                duration: "quarter",
                octave: 0,
                accidental: "none",
                dotted: false,
                tieToNext: false,
                lyric: { text: "旧歌词" },
              },
            ],
          },
        ],
      },
    });
    storage.values.set(SCORE_DRAFT_STORAGE_KEY, legacy);

    const result = restoreDraft(storage);

    expect(result.kind).toBe("restored");
    expect(storage.setCalls).toBe(1);
    expect(storage.values.get(SCORE_DRAFT_STORAGE_KEY)).not.toContain(
      "旧作者",
    );
    expect(storage.values.get(SCORE_DRAFT_STORAGE_KEY)).not.toContain(
      "旧歌词",
    );
  });

  it("keeps a damaged draft byte-for-byte and never overwrites it while restoring", () => {
    const storage = new MemoryStorage();
    const damaged = '{"format":"jianpu-editor","version":999,"score":';
    storage.values.set(SCORE_DRAFT_STORAGE_KEY, damaged);

    const result = restoreDraft(storage);

    expect(result).toMatchObject({ kind: "invalid", raw: damaged });
    expect(storage.values.get(SCORE_DRAFT_STORAGE_KEY)).toBe(damaged);
    expect(storage.setCalls).toBe(0);
  });

  it("reports unavailable storage reads and write failures", () => {
    const storage = new MemoryStorage();
    storage.failReads = true;
    expect(restoreDraft(storage)).toMatchObject({ kind: "unavailable" });

    storage.failReads = false;
    storage.failWrites = true;
    expect(() => saveDraft(storage, titledScore("失败"))).toThrow(
      "quota exceeded",
    );
  });
});

describe("debounced draft saver", () => {
  it("only saves the latest score during frequent input and reports accurate states", () => {
    const storage = new MemoryStorage();
    const scheduler = new ManualScheduler();
    const events: SaveStatusEvent[] = [];
    const saver = new DebouncedDraftSaver(
      storage,
      (event) => events.push(event),
      500,
      scheduler,
    );
    const first = titledScore("第一版");
    const latest = titledScore("最终版");

    saver.schedule(first);
    saver.schedule(latest);

    expect(scheduler.size).toBe(1);
    expect(events.map(({ status }) => status)).toEqual(["saving", "saving"]);

    scheduler.flush();

    expect(storage.setCalls).toBe(1);
    expect(storage.values.get(SCORE_DRAFT_STORAGE_KEY)).toBe(
      serializeScore(latest),
    );
    expect(events[events.length - 1]).toEqual({
      status: "saved",
      score: latest,
    });
  });

  it("moves from saving to failed without claiming the score was saved", () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const scheduler = new ManualScheduler();
    const events: SaveStatusEvent[] = [];
    const score = titledScore("未保存");
    const saver = new DebouncedDraftSaver(
      storage,
      (event) => events.push(event),
      500,
      scheduler,
    );

    saver.schedule(score);
    scheduler.flush();

    expect(events.map(({ status }) => status)).toEqual(["saving", "failed"]);
    expect(events[events.length - 1]?.score).toBeUndefined();
  });

  it("cancels a pending debounce when an immediate import save starts", () => {
    const storage = new MemoryStorage();
    const scheduler = new ManualScheduler();
    const events: SaveStatusEvent[] = [];
    const saver = new DebouncedDraftSaver(
      storage,
      (event) => events.push(event),
      500,
      scheduler,
    );
    const edited = titledScore("编辑中");
    const imported = titledScore("导入结果");

    saver.schedule(edited);
    expect(saver.saveNow(imported)).toBe(true);
    scheduler.flush();

    expect(storage.setCalls).toBe(1);
    expect(storage.values.get(SCORE_DRAFT_STORAGE_KEY)).toBe(
      serializeScore(imported),
    );
    expect(events[events.length - 1]).toEqual({
      status: "saved",
      score: imported,
    });
  });
});

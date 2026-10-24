import { describe, expect, it } from "vitest";

import {
  createChordDegreeEvent,
  createEmptyScore,
  createSequentialIdFactory,
  serializeScore,
} from "./domain";
import {
  SCORE_JSON_MIME_TYPE,
  confirmNewScore,
  confirmScoreImport,
  createScoreExport,
  importScoreJson,
} from "./fileWorkflow";

function scoreWithChord() {
  const ids = createSequentialIdFactory("file");
  const score = createEmptyScore(ids);
  const measure = score.measures[0];
  return {
    ...score,
    title: '测试 / "和弦"',
    measures: [
      {
        ...measure,
        chords: [createChordDegreeEvent(measure.id, 5, 0, "4/4", ids)],
      },
    ],
  };
}

describe("score file import", () => {
  it("returns a complete compatible score without mutating the current score", () => {
    const current = createEmptyScore(createSequentialIdFactory("current"));
    const imported = scoreWithChord();
    const result = importScoreJson(serializeScore(imported));

    expect(result).toEqual({ ok: true, score: imported });
    expect(current.title).toBe("未命名歌曲");
  });

  it("rejects malformed, incomplete and unsupported documents without a replacement score", () => {
    const malformed = importScoreJson("{broken");
    const incomplete = importScoreJson(
      JSON.stringify({ format: "jianpu-editor", version: 1 }),
    );
    const unsupported = importScoreJson(
      JSON.stringify({ format: "jianpu-editor", version: 2, score: {} }),
    );

    expect(malformed).toMatchObject({
      ok: false,
      error: { code: "INVALID_JSON" },
    });
    expect(incomplete).toMatchObject({
      ok: false,
      error: { code: "INVALID_STRUCTURE" },
    });
    expect(unsupported).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_VERSION" },
    });
    expect("score" in malformed).toBe(false);
    expect("score" in incomplete).toBe(false);
    expect("score" in unsupported).toBe(false);
  });
});

describe("score file export and destructive confirmation", () => {
  it("creates versioned UTF-8 JSON containing chord positions", () => {
    const score = scoreWithChord();
    const exported = createScoreExport(score);
    const document = JSON.parse(exported.content) as {
      version: number;
      score: typeof score;
    };

    expect(exported.mimeType).toBe(SCORE_JSON_MIME_TYPE);
    expect(exported.filename).toBe("测试 - -和弦-.jianpu.json");
    expect(document.version).toBe(1);
    expect(document.score.measures[0].chords).toEqual(
      score.measures[0].chords,
    );
  });

  it("only asks for confirmation when the current score is not saved", () => {
    let calls = 0;
    const confirm = () => {
      calls += 1;
      return false;
    };

    expect(confirmNewScore(false, confirm)).toBe(true);
    expect(calls).toBe(0);
    expect(confirmNewScore(true, confirm)).toBe(false);
    expect(calls).toBe(1);
    expect(confirmScoreImport(confirm)).toBe(false);
    expect(calls).toBe(2);
  });
});

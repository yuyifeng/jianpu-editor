import { describe, expect, it } from "vitest";

import { createChordDegreeEvent } from "./chords";
import {
  createEmptyScore,
  createNote,
  createRest,
  createSequentialIdFactory,
  type Score,
} from "./score";
import {
  SCORE_DOCUMENT_FORMAT,
  isCompatibleScoreVersion,
  parseScoreDocument,
  serializeScore,
  validateScoreDocument,
  type ScoreDocumentErrorCode,
  type ScoreDocumentResult,
} from "./serialization";

function expectErrorCode(
  result: ScoreDocumentResult,
  expectedCode: ScoreDocumentErrorCode,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("Expected score document validation to fail.");
  }
  expect(result.error.code).toBe(expectedCode);
}

function createPopulatedScore(): Score {
  const ids = createSequentialIdFactory("document");
  const score = createEmptyScore(ids);
  const measure = score.measures[0];

  return {
    ...score,
    title: "测试歌曲",
    keySignature: "D",
    mode: "natural-minor",
    timeSignature: "3/4",
    tempo: 108,
    measures: [
      {
        ...measure,
        symbols: [
          createNote(
            {
              degree: 6,
              duration: "eighth",
              octave: 1,
              accidental: "sharp",
              dotted: true,
            },
            ids,
          ),
          createRest({ duration: "sixteenth" }, ids),
        ],
        chords: [createChordDegreeEvent(measure.id, 4, 2, "3/4", ids)],
      },
    ],
  };
}

describe("versioned score serialization", () => {
  it("round-trips complete melody and chord data", () => {
    const score = createPopulatedScore();
    const json = serializeScore(score);
    const parsed = parseScoreDocument(json);

    expect(parsed).toEqual({
      ok: true,
      value: {
        format: SCORE_DOCUMENT_FORMAT,
        version: 1,
        score,
      },
    });
  });

  it("distinguishes malformed JSON from structural failures", () => {
    expectErrorCode(parseScoreDocument("{not-json"), "INVALID_JSON");
    expectErrorCode(validateScoreDocument(null), "INVALID_STRUCTURE");
    expectErrorCode(
      validateScoreDocument({ format: SCORE_DOCUMENT_FORMAT, version: 1 }),
      "INVALID_STRUCTURE",
    );
  });

  it("reports unsupported versions before attempting score import", () => {
    expect(isCompatibleScoreVersion(1)).toBe(true);
    expect(isCompatibleScoreVersion(2)).toBe(false);
    expectErrorCode(
      validateScoreDocument({
        format: SCORE_DOCUMENT_FORMAT,
        version: 2,
        score: {},
      }),
      "UNSUPPORTED_VERSION",
    );
  });

  it("rejects invalid BPM and duplicate stable IDs", () => {
    const score = createPopulatedScore();
    const duplicateIdScore: Score = {
      ...score,
      measures: [
        {
          ...score.measures[0],
          symbols: [
            { ...score.measures[0].symbols[0], id: score.id },
            ...score.measures[0].symbols.slice(1),
          ],
        },
      ],
    };

    expectErrorCode(
      validateScoreDocument({
        format: SCORE_DOCUMENT_FORMAT,
        version: 1,
        score: { ...score, tempo: 241 },
      }),
      "INVALID_STRUCTURE",
    );
    expectErrorCode(
      validateScoreDocument({
        format: SCORE_DOCUMENT_FORMAT,
        version: 1,
        score: duplicateIdScore,
      }),
      "INVALID_STRUCTURE",
    );
  });

  it("strips legacy author and lyric fields while rejecting invalid chord positions", () => {
    const score = createPopulatedScore();
    const measure = score.measures[0];
    const legacyNote = {
      ...measure.symbols[0],
      lyric: { text: "旧歌词" },
    };
    const invalidChord = {
      id: "invalid-chord",
      measureId: "another-measure",
      degree: 1,
      position: 12,
    };

    const legacyResult = validateScoreDocument({
      format: SCORE_DOCUMENT_FORMAT,
      version: 1,
      score: {
        ...score,
        author: "旧作者",
        measures: [{ ...measure, symbols: [legacyNote] }],
      },
    });
    expect(legacyResult.ok).toBe(true);
    if (legacyResult.ok) {
      expect(legacyResult.value.score).not.toHaveProperty("author");
      expect(legacyResult.value.score.measures[0].symbols[0]).not.toHaveProperty(
        "lyric",
      );
    }
    expectErrorCode(
      validateScoreDocument({
        format: SCORE_DOCUMENT_FORMAT,
        version: 1,
        score: {
          ...score,
          measures: [{ ...measure, chords: [invalidChord] }],
        },
      }),
      "INVALID_STRUCTURE",
    );
  });

  it("allows incomplete measures because duration warnings are non-blocking", () => {
    const emptyScore = createEmptyScore(createSequentialIdFactory("empty"));
    const result = parseScoreDocument(serializeScore(emptyScore));

    expect(result.ok).toBe(true);
  });
});

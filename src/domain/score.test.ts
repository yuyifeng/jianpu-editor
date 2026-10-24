import { describe, expect, it } from "vitest";

import {
  createEmptyScore,
  createNote,
  createRest,
  createSequentialIdFactory,
  deleteMeasure,
  getMeasureDuration,
  getMeasureDurationStatus,
  getTimeSignatureCapacity,
  insertMeasureAfter,
  setTieToNext,
  updateNote,
  updateSymbolDuration,
  type Measure,
} from "./score";

describe("score model", () => {
  it("creates a deterministic empty score with one editable measure", () => {
    const score = createEmptyScore(createSequentialIdFactory("test"));

    expect(score).toEqual({
      id: "test-score-1",
      title: "未命名歌曲",
      keySignature: "C",
      mode: "major",
      timeSignature: "4/4",
      tempo: 90,
      measures: [
        {
          id: "test-measure-1",
          symbols: [],
          chords: [],
        },
      ],
    });
  });

  it.each([
    ["2/4", 8],
    ["3/4", 12],
    ["4/4", 16],
    ["6/8", 12],
  ] as const)("calculates the %s capacity in sixteenth-note units", (signature, capacity) => {
    expect(getTimeSignatureCapacity(signature)).toBe(capacity);
  });

  it("calculates dotted values and reports non-blocking measure duration status", () => {
    const ids = createSequentialIdFactory("duration");
    const measure: Measure = {
      id: ids("measure"),
      symbols: [
        createNote({ degree: 1, duration: "half", dotted: true }, ids),
        createRest({ duration: "quarter" }, ids),
      ],
      chords: [],
    };

    expect(getMeasureDuration(measure)).toBe(16);
    expect(getMeasureDurationStatus(measure, "4/4")).toBe("exact");
    expect(getMeasureDurationStatus(measure, "3/4")).toBe("overfilled");
    expect(getMeasureDurationStatus({ ...measure, symbols: measure.symbols.slice(0, 1) }, "4/4"))
      .toBe("underfilled");
  });

  it("updates pitch, octave, accidental and duration without mutating the source note", () => {
    const ids = createSequentialIdFactory("note");
    const original = createNote({ degree: 1 }, ids);
    const pitched = updateNote(original, {
      degree: 5,
      octave: 2,
      accidental: "sharp",
      dotted: true,
    });
    const shortened = updateSymbolDuration(pitched, "eighth");

    expect(original).toMatchObject({
      degree: 1,
      octave: 0,
      accidental: "none",
      duration: "quarter",
      dotted: false,
    });
    expect(shortened).toMatchObject({
      degree: 5,
      octave: 2,
      accidental: "sharp",
      duration: "eighth",
      dotted: true,
    });
  });

  it("only creates a tie to an adjacent note with the same sounding pitch", () => {
    const ids = createSequentialIdFactory("tie");
    const first = createNote({ degree: 3, octave: 1, accidental: "flat" }, ids);
    const samePitch = createNote({ degree: 3, octave: 1, accidental: "flat" }, ids);
    const differentPitch = createNote({ degree: 4, octave: 1, accidental: "flat" }, ids);

    expect(setTieToNext(first, samePitch, true).tieToNext).toBe(true);
    expect(() => setTieToNext(first, differentPitch, true)).toThrow(RangeError);
    expect(() => setTieToNext(first, undefined, true)).toThrow(RangeError);
    expect(setTieToNext({ ...first, tieToNext: true }, undefined, false).tieToNext).toBe(false);
  });

  it("inserts after the selected measure and clears rather than removes the final measure", () => {
    const ids = createSequentialIdFactory("measure");
    const initial = createEmptyScore(ids);
    const inserted = insertMeasureAfter(initial, initial.measures[0].id, ids);
    const populatedLast = {
      ...inserted,
      measures: [
        inserted.measures[0],
        {
          ...inserted.measures[1],
          symbols: [createRest({}, ids)],
        },
      ],
    };
    const oneMeasure = deleteMeasure(populatedLast, inserted.measures[0].id);
    const cleared = deleteMeasure(oneMeasure, oneMeasure.measures[0].id);

    expect(initial.measures).toHaveLength(1);
    expect(inserted.measures.map((measure) => measure.id)).toEqual([
      "measure-measure-1",
      "measure-measure-2",
    ]);
    expect(cleared.measures).toEqual([
      {
        id: "measure-measure-2",
        symbols: [],
        chords: [],
      },
    ]);
  });
});

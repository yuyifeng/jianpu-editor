import { describe, expect, it } from "vitest";

import {
  createChordDegreeEvent,
  getChordQuality,
  isValidChordPosition,
  mapChordDegreeToMidi,
  upsertChordDegreeEvent,
} from "./chords";
import {
  createEmptyMeasure,
  createSequentialIdFactory,
  type Mode,
  type ScaleDegree,
} from "./score";

describe("chord degree events", () => {
  it("accepts only integer sixteenth-note positions inside the measure", () => {
    expect(isValidChordPosition(0, "2/4")).toBe(true);
    expect(isValidChordPosition(7, "2/4")).toBe(true);
    expect(isValidChordPosition(8, "2/4")).toBe(false);
    expect(isValidChordPosition(11, "6/8")).toBe(true);
    expect(isValidChordPosition(12, "6/8")).toBe(false);
    expect(isValidChordPosition(1.5, "4/4")).toBe(false);
    expect(isValidChordPosition(-1, "4/4")).toBe(false);
  });

  it("creates stable events and rejects out-of-range positions", () => {
    const ids = createSequentialIdFactory("event");

    expect(createChordDegreeEvent("measure-1", 5, 4, "4/4", ids)).toEqual({
      id: "event-chord-1",
      measureId: "measure-1",
      degree: 5,
      position: 4,
    });
    expect(() => createChordDegreeEvent("measure-1", 1, 16, "4/4", ids)).toThrow(
      RangeError,
    );
  });

  it("replaces the degree at an occupied position while preserving its event ID", () => {
    const ids = createSequentialIdFactory("upsert");
    const empty = createEmptyMeasure(ids);
    const inserted = upsertChordDegreeEvent(empty, 1, 0, "4/4", ids);
    const replaced = upsertChordDegreeEvent(inserted, 6, 0, "4/4", ids);

    expect(replaced.chords).toEqual([
      {
        id: "upsert-chord-1",
        measureId: "upsert-measure-1",
        degree: 6,
        position: 0,
      },
    ]);
    expect(inserted.chords[0].degree).toBe(1);
  });
});

describe("diatonic triad mapping", () => {
  const cases: ReadonlyArray<{
    mode: Mode;
    degree: ScaleDegree;
    quality: "major" | "minor" | "diminished";
    midi: readonly [number, number, number];
  }> = [
    { mode: "major", degree: 1, quality: "major", midi: [60, 64, 67] },
    { mode: "major", degree: 2, quality: "minor", midi: [62, 65, 69] },
    { mode: "major", degree: 3, quality: "minor", midi: [64, 67, 71] },
    { mode: "major", degree: 4, quality: "major", midi: [65, 69, 72] },
    { mode: "major", degree: 5, quality: "major", midi: [67, 71, 74] },
    { mode: "major", degree: 6, quality: "minor", midi: [69, 72, 76] },
    { mode: "major", degree: 7, quality: "diminished", midi: [71, 74, 77] },
    { mode: "natural-minor", degree: 1, quality: "minor", midi: [60, 63, 67] },
    {
      mode: "natural-minor",
      degree: 2,
      quality: "diminished",
      midi: [62, 65, 68],
    },
    { mode: "natural-minor", degree: 3, quality: "major", midi: [63, 67, 70] },
    { mode: "natural-minor", degree: 4, quality: "minor", midi: [65, 68, 72] },
    { mode: "natural-minor", degree: 5, quality: "minor", midi: [67, 70, 74] },
    { mode: "natural-minor", degree: 6, quality: "major", midi: [68, 72, 75] },
    { mode: "natural-minor", degree: 7, quality: "major", midi: [70, 74, 77] },
  ];

  it.each(cases)(
    "maps C $mode degree $degree to its $quality triad",
    ({ mode, degree, quality, midi }) => {
      expect(getChordQuality(mode, degree)).toBe(quality);
      expect(mapChordDegreeToMidi("C", mode, degree)).toEqual(midi);
    },
  );

  it("transposes the tonic while retaining the diatonic quality", () => {
    expect(mapChordDegreeToMidi("D", "major", 1)).toEqual([62, 66, 69]);
    expect(mapChordDegreeToMidi("F#/Gb", "natural-minor", 2)).toEqual([68, 71, 74]);
  });
});

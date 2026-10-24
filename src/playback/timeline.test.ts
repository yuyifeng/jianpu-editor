import { describe, expect, it } from "vitest";

import {
  createEmptyMeasure,
  createEmptyScore,
  createNote,
  createRest,
  createSequentialIdFactory,
  type Score,
} from "../domain";
import {
  buildPlaybackTimeline,
  getCursorStartUnits,
  getPlaybackFrame,
  getPlaybackStartSeconds,
  mapNoteToMidi,
} from "./timeline";

function playbackScore(): Score {
  const ids = createSequentialIdFactory("playback");
  const score = createEmptyScore(ids);
  const secondMeasure = createEmptyMeasure(ids);
  return {
    ...score,
    tempo: 120,
    measures: [
      {
        ...score.measures[0],
        symbols: [
          createNote(
            { degree: 1, duration: "quarter", tieToNext: true },
            ids,
          ),
          createNote({ degree: 1, duration: "quarter" }, ids),
          createRest({ duration: "half" }, ids),
        ],
        chords: [
          {
            id: "chord-one",
            measureId: score.measures[0].id,
            degree: 1,
            position: 0,
          },
          {
            id: "chord-five",
            measureId: score.measures[0].id,
            degree: 5,
            position: 8,
          },
        ],
      },
      {
        ...secondMeasure,
        symbols: [
          createNote({ degree: 3, duration: "quarter" }, ids),
          createNote(
            {
              degree: 4,
              duration: "eighth",
              dotted: true,
              extension: 1,
              octave: 1,
              accidental: "flat",
            },
            ids,
          ),
        ],
        chords: [
          {
            id: "chord-four",
            measureId: secondMeasure.id,
            degree: 4,
            position: 4,
          },
        ],
      },
    ],
  };
}

describe("playback timeline", () => {
  it("fits three eighth-note triplets into one quarter-note beat", () => {
    const ids = createSequentialIdFactory("triplet");
    const score = createEmptyScore(ids);
    const tripletScore: Score = {
      ...score,
      measures: [
        {
          ...score.measures[0],
          symbols: [1, 2, 3].map((degree) =>
            createNote(
              {
                degree: degree as 1 | 2 | 3,
                duration: "eighth-triplet",
              },
              ids,
            ),
          ),
        },
      ],
    };

    const timeline = buildPlaybackTimeline(tripletScore);

    expect(timeline.melody[0]).toMatchObject({ startUnits: 0 });
    expect(timeline.melody[1].startUnits).toBeCloseTo(4 / 3);
    expect(timeline.melody[2].startUnits).toBeCloseTo(8 / 3);
    expect(timeline.melody[2].endUnits).toBeCloseTo(4);
  });

  it("converts tempo, dotted durations and extensions into one timeline", () => {
    const timeline = buildPlaybackTimeline(playbackScore());

    expect(timeline.secondsPerUnit).toBe(0.125);
    expect(timeline.durationUnits).toBe(32);
    expect(timeline.durationSeconds).toBe(4);
    expect(
      timeline.melody.map(({ startUnits, endUnits }) => ({
        startUnits,
        endUnits,
      })),
    ).toEqual([
      { startUnits: 0, endUnits: 4 },
      { startUnits: 4, endUnits: 8 },
      { startUnits: 8, endUnits: 16 },
      { startUnits: 16, endUnits: 20 },
      { startUnits: 20, endUnits: 24 },
    ]);
  });

  it("merges tied notes into one voice while preserving symbol highlights and rests", () => {
    const timeline = buildPlaybackTimeline(playbackScore());

    expect(timeline.melody).toHaveLength(5);
    expect(timeline.melodyVoices).toEqual([
      {
        id: "melody:playback-note-1",
        startUnits: 0,
        endUnits: 8,
        midi: 60,
      },
      {
        id: "melody:playback-note-3",
        startUnits: 16,
        endUnits: 20,
        midi: 64,
      },
      {
        id: "melody:playback-note-4",
        startUnits: 20,
        endUnits: 24,
        midi: 76,
      },
    ]);
    expect(getPlaybackFrame(timeline, 1.2)).toEqual({
      symbolId: "playback-rest-1",
      chordId: "chord-five",
    });
  });

  it("holds each chord until the next marker and the final chord to song end", () => {
    const timeline = buildPlaybackTimeline(playbackScore());

    expect(
      timeline.chords.map(({ chordId, startUnits, endUnits, midi }) => ({
        chordId,
        startUnits,
        endUnits,
        midi,
      })),
    ).toEqual([
      {
        chordId: "chord-one",
        startUnits: 0,
        endUnits: 8,
        midi: [48, 52, 55],
      },
      {
        chordId: "chord-five",
        startUnits: 8,
        endUnits: 20,
        midi: [55, 59, 62],
      },
      {
        chordId: "chord-four",
        startUnits: 20,
        endUnits: 32,
        midi: [53, 57, 60],
      },
    ]);
  });

  it("restores the effective earlier chord when playback starts in the middle", () => {
    const score = playbackScore();
    const timeline = buildPlaybackTimeline(score);
    const cursor = {
      context: "melody" as const,
      measureId: score.measures[1].id,
      symbolIndex: 0,
    };
    const startSeconds = getPlaybackStartSeconds(timeline, score, cursor);

    expect(getCursorStartUnits(score, cursor)).toBe(16);
    expect(startSeconds).toBe(2);
    expect(getPlaybackFrame(timeline, startSeconds)).toEqual({
      symbolId: "playback-note-3",
      chordId: "chord-five",
    });
  });

  it("builds a melody-only timeline without synthetic chord events", () => {
    const score = playbackScore();
    const withoutChords: Score = {
      ...score,
      measures: score.measures.map((measure) => ({
        ...measure,
        chords: [],
      })),
    };
    const timeline = buildPlaybackTimeline(withoutChords);

    expect(timeline.chords).toEqual([]);
    expect(getPlaybackFrame(timeline, 0)).toEqual({
      symbolId: "playback-note-1",
    });
  });
});

describe("jianpu pitch mapping", () => {
  it("uses key, mode, octave and chromatic accidentals", () => {
    const ids = createSequentialIdFactory("pitch");
    const dMajorThird = createNote({ degree: 3 }, ids);
    const naturalThird = createNote(
      { degree: 3, accidental: "natural" },
      ids,
    );
    const minorThird = createNote({ degree: 3 }, ids);
    const raisedHighTonic = createNote(
      { degree: 1, octave: 1, accidental: "sharp" },
      ids,
    );

    expect(mapNoteToMidi(dMajorThird, "D", "major")).toBe(66);
    expect(mapNoteToMidi(naturalThird, "D", "major")).toBe(65);
    expect(mapNoteToMidi(minorThird, "C", "natural-minor")).toBe(63);
    expect(mapNoteToMidi(naturalThird, "C", "natural-minor")).toBe(64);
    expect(mapNoteToMidi(raisedHighTonic, "C", "major")).toBe(73);
  });
});

import { describe, expect, it } from "vitest";

import {
  createEditorState,
  reduceEditorState,
  type EditorAction,
  type EditorState,
} from "./editing";
import {
  createEmptyScore,
  createNote,
  createRest,
  createSequentialIdFactory,
  type IdFactory,
  type Score,
} from "./score";

function reducer(idFactory: IdFactory) {
  return (state: EditorState, action: EditorAction): EditorState =>
    reduceEditorState(state, action, idFactory);
}

function scoreWithMelody(idFactory: IdFactory): Score {
  const score = createEmptyScore(idFactory);
  return {
    ...score,
    measures: [
      {
        ...score.measures[0],
        symbols: [
          createNote(
            {
              degree: 1,
              tieToNext: true,
            },
            idFactory,
          ),
          createNote({ degree: 1 }, idFactory),
          createRest({}, idFactory),
        ],
      },
    ],
  };
}

describe("editor melody context", () => {
  it("inserts notes and rests with the active input settings and advances the cursor", () => {
    const ids = createSequentialIdFactory("input");
    const reduce = reducer(ids);
    let state = createEditorState(createEmptyScore(ids));

    state = reduce(state, {
      type: "set-input",
      changes: {
        duration: "eighth",
        octave: 1,
        accidental: "sharp",
        dotted: true,
        extension: 1,
      },
    });
    state = reduce(state, { type: "input-degree", degree: 3 });
    state = reduce(state, { type: "input-rest" });

    expect(state.score.measures[0].symbols).toEqual([
      {
        id: "input-note-1",
        kind: "note",
        degree: 3,
        duration: "eighth",
        octave: 1,
        accidental: "sharp",
        dotted: true,
        extension: 1,
        tieToNext: false,
      },
      {
        id: "input-rest-1",
        kind: "rest",
        duration: "eighth",
        dotted: true,
        extension: 1,
      },
    ]);
    expect(state.cursor).toEqual({
      context: "melody",
      measureId: "input-measure-1",
      symbolIndex: 2,
    });
    expect(state.history.past).toHaveLength(2);
  });

  it("updates selected notes in place, preserves ties, then deletes a range", () => {
    const ids = createSequentialIdFactory("replace");
    const reduce = reducer(ids);
    let state = createEditorState(scoreWithMelody(ids));
    const measureId = state.score.measures[0].id;

    state = reduce(state, {
      type: "set-selection",
      selection: { context: "melody", measureId, start: 0, end: 1 },
    });
    state = reduce(state, {
      type: "update-selected-melody",
      changes: { degree: 5, duration: "half", dotted: true, extension: 1 },
    });

    expect(state.score.measures[0].symbols[0]).toMatchObject({
      id: "replace-note-1",
      degree: 5,
      duration: "half",
      dotted: true,
      extension: 1,
      tieToNext: true,
    });

    state = reduce(state, {
      type: "set-selection",
      selection: { context: "melody", measureId, start: 0, end: 2 },
    });
    state = reduce(state, { type: "delete-forward" });

    expect(state.score.measures[0].symbols).toEqual([
      {
        id: "replace-rest-1",
        kind: "rest",
        duration: "quarter",
        dotted: false,
        extension: 0,
      },
    ]);
    expect(state.cursor).toMatchObject({ context: "melody", symbolIndex: 0 });
  });

  it("copies a continuous melody range and pastes new IDs with undo and redo", () => {
    const ids = createSequentialIdFactory("melody-copy");
    const reduce = reducer(ids);
    let state = createEditorState(scoreWithMelody(ids));
    const measureId = state.score.measures[0].id;
    const sourceIds = state.score.measures[0].symbols.slice(0, 2).map(({ id }) => id);

    state = reduce(state, {
      type: "set-selection",
      selection: { context: "melody", measureId, start: 0, end: 2 },
    });
    state = reduce(state, { type: "copy" });
    state = reduce(state, {
      type: "set-cursor",
      cursor: { context: "melody", measureId, symbolIndex: 3 },
    });
    state = reduce(state, { type: "paste" });

    const pasted = state.score.measures[0].symbols.slice(3);
    expect(pasted.map(({ id }) => id)).toEqual([
      "melody-copy-note-3",
      "melody-copy-note-4",
    ]);
    expect(pasted.map((symbol) => ({ ...symbol, id: "" }))).toEqual(
      state.score.measures[0].symbols
        .slice(0, 2)
        .map((symbol) => ({ ...symbol, id: "" })),
    );
    expect(pasted.every(({ id }) => !sourceIds.includes(id))).toBe(true);

    const pastedScore = state.score;
    state = reduce(state, { type: "undo" });
    expect(state.score.measures[0].symbols).toHaveLength(3);
    state = reduce(state, { type: "redo" });
    expect(state.score).toBe(pastedScore);
  });
});

describe("editor chord context", () => {
  it("uses numeric input for chord upsert while zero remains melody-only", () => {
    const ids = createSequentialIdFactory("chord-input");
    const reduce = reducer(ids);
    let state = createEditorState(createEmptyScore(ids));
    const measureId = state.score.measures[0].id;

    state = reduce(state, {
      type: "set-cursor",
      cursor: { context: "chord", measureId, position: 4 },
    });
    state = reduce(state, { type: "input-degree", degree: 5 });
    const insertedId = state.score.measures[0].chords[0].id;
    state = reduce(state, { type: "input-degree", degree: 2 });
    const afterRestInput = reduce(state, { type: "input-rest" });

    expect(state.score.measures[0].chords).toEqual([
      {
        id: insertedId,
        measureId,
        degree: 2,
        position: 4,
      },
    ]);
    expect(afterRestInput).toBe(state);
  });

  it("copies and pastes multiple chord events with relative positions and fresh IDs", () => {
    const ids = createSequentialIdFactory("chord-copy");
    const reduce = reducer(ids);
    let state = createEditorState(createEmptyScore(ids));
    const measureId = state.score.measures[0].id;

    state = reduce(state, {
      type: "set-cursor",
      cursor: { context: "chord", measureId, position: 0 },
    });
    state = reduce(state, { type: "input-degree", degree: 1 });
    state = reduce(state, {
      type: "set-cursor",
      cursor: { context: "chord", measureId, position: 4 },
    });
    state = reduce(state, { type: "input-degree", degree: 5 });
    const sourceIds = state.score.measures[0].chords.map(({ id }) => id);

    state = reduce(state, {
      type: "set-selection",
      selection: {
        context: "chord",
        measureId,
        startPosition: 0,
        endPosition: 4,
      },
    });
    state = reduce(state, { type: "copy" });
    state = reduce(state, {
      type: "set-cursor",
      cursor: { context: "chord", measureId, position: 8 },
    });
    state = reduce(state, { type: "paste" });

    expect(
      state.score.measures[0].chords.map(({ degree, position }) => ({
        degree,
        position,
      })),
    ).toEqual([
      { degree: 1, position: 0 },
      { degree: 5, position: 4 },
      { degree: 1, position: 8 },
      { degree: 5, position: 12 },
    ]);
    const pastedIds = state.score.measures[0].chords.slice(2).map(({ id }) => id);
    expect(pastedIds).toEqual(["chord-copy-chord-3", "chord-copy-chord-4"]);
    expect(pastedIds.every((id) => !sourceIds.includes(id))).toBe(true);

    state = reduce(state, {
      type: "set-cursor",
      cursor: { context: "chord", measureId, position: 13 },
    });
    expect(reduce(state, { type: "paste" })).toBe(state);
  });

  it("moves a chord across measures without changing melody content", () => {
    const ids = createSequentialIdFactory("move");
    const reduce = reducer(ids);
    let state = createEditorState(scoreWithMelody(ids));
    const firstMeasureId = state.score.measures[0].id;
    state = reduce(state, {
      type: "set-cursor",
      cursor: { context: "chord", measureId: firstMeasureId, position: 0 },
    });
    state = reduce(state, { type: "input-degree", degree: 4 });
    const chordId = state.score.measures[0].chords[0].id;
    const melody = state.score.measures[0].symbols;
    state = reduce(state, {
      type: "insert-measure-after",
      measureId: firstMeasureId,
    });
    const secondMeasureId = state.score.measures[1].id;

    state = reduce(state, {
      type: "move-chord",
      chordId,
      target: { measureId: secondMeasureId, position: 6 },
    });

    expect(state.score.measures[0].symbols).toBe(melody);
    expect(state.score.measures[0].chords).toEqual([]);
    expect(state.score.measures[1].chords).toEqual([
      {
        id: chordId,
        measureId: secondMeasureId,
        degree: 4,
        position: 6,
      },
    ]);
  });

  it("replaces an occupied move target, rejects invalid targets, and undoes the move", () => {
    const ids = createSequentialIdFactory("move-boundary");
    const reduce = reducer(ids);
    let state = createEditorState(createEmptyScore(ids));
    const firstMeasureId = state.score.measures[0].id;
    state = reduce(state, {
      type: "set-cursor",
      cursor: { context: "chord", measureId: firstMeasureId, position: 2 },
    });
    state = reduce(state, { type: "input-degree", degree: 3 });
    const movedChordId = state.score.measures[0].chords[0].id;
    state = reduce(state, {
      type: "insert-measure-after",
      measureId: firstMeasureId,
    });
    const secondMeasureId = state.score.measures[1].id;
    state = reduce(state, {
      type: "set-cursor",
      cursor: { context: "chord", measureId: secondMeasureId, position: 5 },
    });
    state = reduce(state, { type: "input-degree", degree: 7 });
    const beforeMove = state;

    expect(
      reduce(state, {
        type: "move-chord",
        chordId: movedChordId,
        target: { measureId: secondMeasureId, position: 16 },
      }),
    ).toBe(state);
    expect(
      reduce(state, {
        type: "move-chord",
        chordId: movedChordId,
        target: { measureId: "missing-measure", position: 0 },
      }),
    ).toBe(state);

    state = reduce(state, {
      type: "move-chord",
      chordId: movedChordId,
      target: { measureId: secondMeasureId, position: 5 },
    });

    expect(state.score.measures[0].chords).toEqual([]);
    expect(state.score.measures[1].chords).toEqual([
      {
        id: movedChordId,
        measureId: secondMeasureId,
        degree: 3,
        position: 5,
      },
    ]);
    expect(state.history.past).toHaveLength(beforeMove.history.past.length + 1);

    state = reduce(state, { type: "undo" });
    expect(state.score).toBe(beforeMove.score);
  });

  it("deletes a selected chord range and restores it through undo", () => {
    const ids = createSequentialIdFactory("chord-delete");
    const reduce = reducer(ids);
    let state = createEditorState(createEmptyScore(ids));
    const measureId = state.score.measures[0].id;

    for (const [position, degree] of [
      [0, 1],
      [4, 4],
      [8, 5],
    ] as const) {
      state = reduce(state, {
        type: "set-cursor",
        cursor: { context: "chord", measureId, position },
      });
      state = reduce(state, { type: "input-degree", degree });
    }
    const beforeDelete = state.score;
    state = reduce(state, {
      type: "set-selection",
      selection: {
        context: "chord",
        measureId,
        startPosition: 3,
        endPosition: 8,
      },
    });
    state = reduce(state, { type: "delete-forward" });

    expect(
      state.score.measures[0].chords.map(({ degree, position }) => ({
        degree,
        position,
      })),
    ).toEqual([{ degree: 1, position: 0 }]);
    state = reduce(state, { type: "undo" });
    expect(state.score).toBe(beforeDelete);
  });

  it("keeps the chord cursor valid when the time signature shrinks", () => {
    const ids = createSequentialIdFactory("meter");
    const reduce = reducer(ids);
    let state = createEditorState(createEmptyScore(ids));
    const measureId = state.score.measures[0].id;
    state = reduce(state, {
      type: "set-cursor",
      cursor: { context: "chord", measureId, position: 15 },
    });

    state = reduce(state, {
      type: "set-score-metadata",
      changes: { timeSignature: "2/4" },
    });

    expect(state.cursor).toEqual({
      context: "chord",
      measureId,
      position: 7,
    });
    state = reduce(state, { type: "undo" });
    expect(state.score.timeSignature).toBe("4/4");
    expect(state.cursor).toMatchObject({ context: "chord", position: 15 });
  });
});

describe("editor history boundaries", () => {
  it("undoes score metadata while retaining playback and scroll state", () => {
    const ids = createSequentialIdFactory("history");
    const reduce = reducer(ids);
    let state = createEditorState(scoreWithMelody(ids));
    const noteId = state.score.measures[0].symbols[0].id;

    state = reduce(state, {
      type: "set-score-metadata",
      changes: { title: "新标题", tempo: 120 },
    });
    state = reduce(state, {
      type: "set-playback",
      playback: { status: "playing", symbolId: noteId },
    });
    state = reduce(state, {
      type: "set-scroll",
      scroll: { left: 24, top: 180 },
    });

    expect(state.history.past).toHaveLength(1);
    state = reduce(state, { type: "undo" });
    expect(state.score).toMatchObject({
      title: "未命名歌曲",
      tempo: 90,
    });
    expect(state.playback.status).toBe("playing");
    expect(state.scroll).toEqual({ left: 24, top: 180 });
  });

  it("does not record no-op edits and clears redo after a new score edit", () => {
    const ids = createSequentialIdFactory("branch");
    const reduce = reducer(ids);
    let state = createEditorState(createEmptyScore(ids));

    expect(
      reduce(state, {
        type: "set-score-metadata",
        changes: { title: state.score.title },
      }),
    ).toBe(state);
    state = reduce(state, { type: "input-degree", degree: 1 });
    state = reduce(state, { type: "undo" });
    expect(state.history.future).toHaveLength(1);

    state = reduce(state, {
      type: "set-score-metadata",
      changes: { keySignature: "D", mode: "natural-minor" },
    });
    expect(state.history.future).toEqual([]);
    expect(state.score.measures[0].symbols).toEqual([]);
  });

  it("resets history when replacing a score for a new or imported document", () => {
    const ids = createSequentialIdFactory("replace-score");
    const reduce = reducer(ids);
    let state = createEditorState(createEmptyScore(ids));
    state = reduce(state, { type: "input-degree", degree: 7 });
    const replacement = {
      ...createEmptyScore(ids),
      title: "导入歌曲",
    };

    state = reduce(state, { type: "replace-score", score: replacement });

    expect(state.score).toBe(replacement);
    expect(state.history).toEqual({ past: [], future: [] });
    expect(state.cursor).toEqual({
      context: "melody",
      measureId: replacement.measures[0].id,
      symbolIndex: 0,
    });
  });
});

import { isValidChordPosition } from "./chords";
import {
  createEmptyMeasure,
  createNote,
  createRest,
  generateEntityId,
  getTimeSignatureCapacity,
  type Accidental,
  type ChordDegreeEvent,
  type Duration,
  type IdFactory,
  type MelodySymbol,
  type Note,
  type Octave,
  type ScaleDegree,
  type Score,
} from "./score";

export const EDIT_HISTORY_LIMIT = 100;

export interface MelodyPoint {
  readonly measureId: string;
  readonly symbolIndex: number;
}

export interface ChordPoint {
  readonly measureId: string;
  readonly position: number;
}

export type EditorCursor =
  | ({ readonly context: "melody" } & MelodyPoint)
  | ({ readonly context: "chord" } & ChordPoint);

export interface MelodySelection {
  readonly context: "melody";
  readonly measureId: string;
  readonly start: number;
  readonly end: number;
}

export interface ChordSelection {
  readonly context: "chord";
  readonly measureId: string;
  readonly startPosition: number;
  readonly endPosition: number;
}

export type EditorSelection = MelodySelection | ChordSelection;

export interface MelodyInputSettings {
  readonly duration: Duration;
  readonly octave: Octave;
  readonly accidental: Accidental;
  readonly dotted: boolean;
}

export interface MelodyClipboard {
  readonly context: "melody";
  readonly symbols: readonly MelodySymbol[];
}

export interface ChordClipboardItem {
  readonly degree: ScaleDegree;
  readonly positionOffset: number;
}

export interface ChordClipboard {
  readonly context: "chord";
  readonly events: readonly ChordClipboardItem[];
}

export type EditorClipboard = MelodyClipboard | ChordClipboard;

export interface PlaybackState {
  readonly status: "stopped" | "playing" | "paused";
  readonly symbolId?: string;
  readonly chordId?: string;
}

export interface ScrollState {
  readonly left: number;
  readonly top: number;
}

export interface EditorSnapshot {
  readonly score: Score;
  readonly cursor: EditorCursor;
  readonly selection: EditorSelection | null;
}

export interface EditorHistory {
  readonly past: readonly EditorSnapshot[];
  readonly future: readonly EditorSnapshot[];
}

export interface EditorState {
  readonly score: Score;
  readonly cursor: EditorCursor;
  readonly selection: EditorSelection | null;
  readonly input: MelodyInputSettings;
  readonly clipboard: EditorClipboard | null;
  readonly playback: PlaybackState;
  readonly scroll: ScrollState;
  readonly history: EditorHistory;
}

export type ScoreMetadataChanges = Partial<
  Pick<
    Score,
    "title" | "keySignature" | "mode" | "timeSignature" | "tempo"
  >
>;

export type MelodySymbolChanges = Partial<
  Pick<
    Note,
    "degree" | "duration" | "octave" | "accidental" | "dotted" | "tieToNext"
  >
>;

export type EditorAction =
  | { readonly type: "set-cursor"; readonly cursor: EditorCursor }
  | { readonly type: "set-selection"; readonly selection: EditorSelection | null }
  | { readonly type: "select-all" }
  | {
      readonly type: "set-input";
      readonly changes: Partial<MelodyInputSettings>;
    }
  | { readonly type: "input-degree"; readonly degree: ScaleDegree }
  | { readonly type: "input-rest" }
  | { readonly type: "update-selected-melody"; readonly changes: MelodySymbolChanges }
  | { readonly type: "set-score-metadata"; readonly changes: ScoreMetadataChanges }
  | { readonly type: "delete-backward" }
  | { readonly type: "delete-forward" }
  | { readonly type: "copy" }
  | { readonly type: "cut" }
  | { readonly type: "paste" }
  | {
      readonly type: "move-chord";
      readonly chordId: string;
      readonly target: ChordPoint;
    }
  | { readonly type: "insert-measure-after"; readonly measureId?: string }
  | { readonly type: "delete-measure"; readonly measureId?: string }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | { readonly type: "replace-score"; readonly score: Score }
  | { readonly type: "set-playback"; readonly playback: PlaybackState }
  | { readonly type: "set-scroll"; readonly scroll: ScrollState };

const DEFAULT_INPUT: MelodyInputSettings = {
  duration: "quarter",
  octave: 0,
  accidental: "none",
  dotted: false,
};

const STOPPED_PLAYBACK: PlaybackState = { status: "stopped" };
const INITIAL_SCROLL: ScrollState = { left: 0, top: 0 };

export function createEditorState(score: Score): EditorState {
  return {
    score,
    cursor: {
      context: "melody",
      measureId: score.measures[0].id,
      symbolIndex: 0,
    },
    selection: null,
    input: DEFAULT_INPUT,
    clipboard: null,
    playback: STOPPED_PLAYBACK,
    scroll: INITIAL_SCROLL,
    history: { past: [], future: [] },
  };
}

function snapshot(state: EditorState): EditorSnapshot {
  return {
    score: state.score,
    cursor: state.cursor,
    selection: state.selection,
  };
}

function commit(
  state: EditorState,
  score: Score,
  cursor: EditorCursor = state.cursor,
  selection: EditorSelection | null = state.selection,
  changes: Partial<Pick<EditorState, "clipboard">> = {},
): EditorState {
  if (
    score === state.score &&
    cursor === state.cursor &&
    selection === state.selection &&
    changes.clipboard === undefined
  ) {
    return state;
  }

  if (score === state.score) {
    return { ...state, cursor, selection, ...changes };
  }

  return {
    ...state,
    ...changes,
    score,
    cursor,
    selection,
    history: {
      past: [...state.history.past, snapshot(state)].slice(-EDIT_HISTORY_LIMIT),
      future: [],
    },
  };
}

function getMeasureIndex(score: Score, measureId: string): number {
  const index = score.measures.findIndex((measure) => measure.id === measureId);
  if (index < 0) {
    throw new RangeError(`Unknown measure: ${measureId}`);
  }
  return index;
}

function assertMelodyPoint(score: Score, point: MelodyPoint): number {
  const measureIndex = getMeasureIndex(score, point.measureId);
  const symbolCount = score.measures[measureIndex].symbols.length;
  if (
    !Number.isInteger(point.symbolIndex) ||
    point.symbolIndex < 0 ||
    point.symbolIndex > symbolCount
  ) {
    throw new RangeError(`Invalid melody position: ${point.symbolIndex}`);
  }
  return measureIndex;
}

function assertChordPoint(score: Score, point: ChordPoint): number {
  const measureIndex = getMeasureIndex(score, point.measureId);
  if (!isValidChordPosition(point.position, score.timeSignature)) {
    throw new RangeError(`Invalid chord position: ${point.position}`);
  }
  return measureIndex;
}

function normalizeSelection(
  score: Score,
  selection: EditorSelection | null,
): EditorSelection | null {
  if (selection === null) {
    return null;
  }

  if (selection.context === "melody") {
    const measureIndex = assertMelodyPoint(score, {
      measureId: selection.measureId,
      symbolIndex: selection.start,
    });
    const symbolCount = score.measures[measureIndex].symbols.length;
    if (
      !Number.isInteger(selection.end) ||
      selection.end < 0 ||
      selection.end > symbolCount
    ) {
      throw new RangeError(`Invalid melody selection end: ${selection.end}`);
    }
    return {
      ...selection,
      start: Math.min(selection.start, selection.end),
      end: Math.max(selection.start, selection.end),
    };
  }

  assertChordPoint(score, {
    measureId: selection.measureId,
    position: selection.startPosition,
  });
  assertChordPoint(score, {
    measureId: selection.measureId,
    position: selection.endPosition,
  });
  return {
    ...selection,
    startPosition: Math.min(selection.startPosition, selection.endPosition),
    endPosition: Math.max(selection.startPosition, selection.endPosition),
  };
}

function updateMeasure(
  score: Score,
  measureIndex: number,
  updater: (measure: Score["measures"][number]) => Score["measures"][number],
): Score {
  const measure = score.measures[measureIndex];
  const updated = updater(measure);
  if (updated === measure) {
    return score;
  }
  const measures = [...score.measures];
  measures[measureIndex] = updated;
  return { ...score, measures };
}

function melodyRange(state: EditorState): {
  readonly measureIndex: number;
  readonly start: number;
  readonly end: number;
} | null {
  if (state.cursor.context !== "melody") {
    return null;
  }
  const measureIndex = assertMelodyPoint(state.score, state.cursor);
  if (
    state.selection === null ||
    state.selection.context !== "melody" ||
    state.selection.measureId !== state.cursor.measureId
  ) {
    return {
      measureIndex,
      start: state.cursor.symbolIndex,
      end: state.cursor.symbolIndex,
    };
  }
  const selection = normalizeSelection(state.score, state.selection) as MelodySelection;
  return { measureIndex, start: selection.start, end: selection.end };
}

function insertMelodySymbol(
  state: EditorState,
  symbol: MelodySymbol,
): EditorState {
  const range = melodyRange(state);
  if (range === null || state.cursor.context !== "melody") {
    return state;
  }
  const score = updateMeasure(state.score, range.measureIndex, (measure) => ({
    ...measure,
    symbols: [
      ...measure.symbols.slice(0, range.start),
      symbol,
      ...measure.symbols.slice(range.end),
    ],
  }));
  return commit(
    state,
    score,
    {
      context: "melody",
      measureId: state.cursor.measureId,
      symbolIndex: range.start + 1,
    },
    null,
  );
}

function inputDegree(
  state: EditorState,
  degree: ScaleDegree,
  idFactory: IdFactory,
): EditorState {
  if (state.cursor.context === "melody") {
    return insertMelodySymbol(
      state,
      createNote({ degree, ...state.input }, idFactory),
    );
  }

  const measureIndex = assertChordPoint(state.score, state.cursor);
  const score = updateMeasure(state.score, measureIndex, (measure) => {
    const existing = measure.chords.find(
      (chord) => chord.position === state.cursor.position,
    );
    if (existing !== undefined && existing.degree === degree) {
      return measure;
    }
    if (existing !== undefined) {
      return {
        ...measure,
        chords: measure.chords.map((chord) =>
          chord.id === existing.id ? { ...chord, degree } : chord,
        ),
      };
    }
    return {
      ...measure,
      chords: [
        ...measure.chords,
        {
          id: idFactory("chord"),
          measureId: measure.id,
          degree,
          position: state.cursor.position,
        },
      ],
    };
  });
  return commit(state, score, state.cursor, null);
}

function copySelection(state: EditorState): EditorClipboard | null {
  if (state.cursor.context === "melody") {
    const range = melodyRange(state);
    if (range === null) {
      return null;
    }
    const measure = state.score.measures[range.measureIndex];
    const end = range.end > range.start ? range.end : range.start + 1;
    const symbols = measure.symbols.slice(range.start, end);
    return symbols.length === 0 ? null : { context: "melody", symbols };
  }

  const measureIndex = assertChordPoint(state.score, state.cursor);
  const measure = state.score.measures[measureIndex];
  const selection =
    state.selection?.context === "chord" &&
    state.selection.measureId === state.cursor.measureId
      ? (normalizeSelection(state.score, state.selection) as ChordSelection)
      : null;
  const start = selection?.startPosition ?? state.cursor.position;
  const end = selection?.endPosition ?? state.cursor.position;
  const chords = measure.chords
    .filter((chord) => chord.position >= start && chord.position <= end)
    .sort((left, right) => left.position - right.position);
  if (chords.length === 0) {
    return null;
  }
  const firstPosition = chords[0].position;
  return {
    context: "chord",
    events: chords.map((chord) => ({
      degree: chord.degree,
      positionOffset: chord.position - firstPosition,
    })),
  };
}

function deleteMelody(state: EditorState, backward: boolean): EditorState {
  const range = melodyRange(state);
  if (range === null || state.cursor.context !== "melody") {
    return state;
  }
  const measure = state.score.measures[range.measureIndex];
  let start = range.start;
  let end = range.end;
  if (start === end) {
    if (backward) {
      if (start === 0) {
        return state;
      }
      start -= 1;
    } else {
      if (end >= measure.symbols.length) {
        return state;
      }
      end += 1;
    }
  }
  const score = updateMeasure(state.score, range.measureIndex, (current) => ({
    ...current,
    symbols: [...current.symbols.slice(0, start), ...current.symbols.slice(end)],
  }));
  return commit(
    state,
    score,
    {
      context: "melody",
      measureId: state.cursor.measureId,
      symbolIndex: start,
    },
    null,
  );
}

function deleteChord(state: EditorState): EditorState {
  if (state.cursor.context !== "chord") {
    return state;
  }
  const measureIndex = assertChordPoint(state.score, state.cursor);
  const selection =
    state.selection?.context === "chord" &&
    state.selection.measureId === state.cursor.measureId
      ? (normalizeSelection(state.score, state.selection) as ChordSelection)
      : null;
  const start = selection?.startPosition ?? state.cursor.position;
  const end = selection?.endPosition ?? state.cursor.position;
  const score = updateMeasure(state.score, measureIndex, (measure) => {
    const chords = measure.chords.filter(
      (chord) => chord.position < start || chord.position > end,
    );
    return chords.length === measure.chords.length ? measure : { ...measure, chords };
  });
  return commit(state, score, state.cursor, null);
}

function deleteContent(state: EditorState, backward: boolean): EditorState {
  return state.cursor.context === "melody"
    ? deleteMelody(state, backward)
    : deleteChord(state);
}

function pasteMelody(
  state: EditorState,
  clipboard: MelodyClipboard,
  idFactory: IdFactory,
): EditorState {
  const range = melodyRange(state);
  if (
    range === null ||
    state.cursor.context !== "melody" ||
    clipboard.symbols.length === 0
  ) {
    return state;
  }
  const symbols = clipboard.symbols.map((symbol) => ({
    ...symbol,
    id: idFactory(symbol.kind),
  }));
  const score = updateMeasure(state.score, range.measureIndex, (measure) => ({
    ...measure,
    symbols: [
      ...measure.symbols.slice(0, range.start),
      ...symbols,
      ...measure.symbols.slice(range.end),
    ],
  }));
  return commit(
    state,
    score,
    {
      context: "melody",
      measureId: state.cursor.measureId,
      symbolIndex: range.start + symbols.length,
    },
    {
      context: "melody",
      measureId: state.cursor.measureId,
      start: range.start,
      end: range.start + symbols.length,
    },
  );
}

function pasteChords(
  state: EditorState,
  clipboard: ChordClipboard,
  idFactory: IdFactory,
): EditorState {
  if (
    state.cursor.context !== "chord" ||
    clipboard.events.length === 0
  ) {
    return state;
  }
  const measureIndex = assertChordPoint(state.score, state.cursor);
  const positions = clipboard.events.map(
    (event) => state.cursor.position + event.positionOffset,
  );
  if (
    positions.some(
      (position) => !isValidChordPosition(position, state.score.timeSignature),
    )
  ) {
    return state;
  }
  const pasted = clipboard.events.map<ChordDegreeEvent>((event, index) => ({
    id: idFactory("chord"),
    measureId: state.cursor.measureId,
    degree: event.degree,
    position: positions[index],
  }));
  const occupied = new Set(positions);
  const score = updateMeasure(state.score, measureIndex, (measure) => ({
    ...measure,
    chords: [
      ...measure.chords.filter((chord) => !occupied.has(chord.position)),
      ...pasted,
    ].sort((left, right) => left.position - right.position),
  }));
  return commit(
    state,
    score,
    state.cursor,
    {
      context: "chord",
      measureId: state.cursor.measureId,
      startPosition: positions[0],
      endPosition: positions[positions.length - 1],
    },
  );
}

function updateSelectedMelody(
  state: EditorState,
  changes: MelodySymbolChanges,
): EditorState {
  if (
    state.selection?.context !== "melody" ||
    state.cursor.context !== "melody"
  ) {
    return state;
  }
  const selection = normalizeSelection(
    state.score,
    state.selection,
  ) as MelodySelection;
  if (selection.start === selection.end) {
    return state;
  }
  const measureIndex = getMeasureIndex(state.score, selection.measureId);
  const score = updateMeasure(state.score, measureIndex, (measure) => {
    let changed = false;
    const symbols = measure.symbols.map((symbol, index) => {
      if (index < selection.start || index >= selection.end) {
        return symbol;
      }
      if (symbol.kind === "rest") {
        const duration = changes.duration ?? symbol.duration;
        const dotted = changes.dotted ?? symbol.dotted;
        if (duration === symbol.duration && dotted === symbol.dotted) {
          return symbol;
        }
        changed = true;
        return { ...symbol, duration, dotted };
      }
      const updated = { ...symbol, ...changes };
      if (
        updated.degree === symbol.degree &&
        updated.duration === symbol.duration &&
        updated.octave === symbol.octave &&
        updated.accidental === symbol.accidental &&
        updated.dotted === symbol.dotted &&
        updated.tieToNext === symbol.tieToNext
      ) {
        return symbol;
      }
      changed = true;
      return updated;
    });
    return changed ? { ...measure, symbols } : measure;
  });
  return commit(state, score);
}

function setScoreMetadata(
  state: EditorState,
  changes: ScoreMetadataChanges,
): EditorState {
  if (
    changes.tempo !== undefined &&
    (!Number.isInteger(changes.tempo) || changes.tempo < 30 || changes.tempo > 240)
  ) {
    throw new RangeError("Tempo must be an integer from 30 through 240.");
  }
  if (changes.timeSignature !== undefined) {
    const capacity = getTimeSignatureCapacity(changes.timeSignature);
    const invalidChord = state.score.measures.some((measure) =>
      measure.chords.some((chord) => chord.position >= capacity),
    );
    if (invalidChord) {
      throw new RangeError(
        "The time signature cannot exclude an existing chord position.",
      );
    }
  }
  const score = { ...state.score, ...changes };
  const unchanged = (
    Object.keys(changes) as Array<keyof ScoreMetadataChanges>
  ).every((key) => score[key] === state.score[key]);
  if (unchanged) {
    return state;
  }

  if (
    changes.timeSignature === undefined ||
    state.cursor.context !== "chord"
  ) {
    return commit(state, score);
  }
  const lastPosition = getTimeSignatureCapacity(changes.timeSignature) - 1;
  const cursor: EditorCursor = {
    ...state.cursor,
    position: Math.min(state.cursor.position, lastPosition),
  };
  const selection =
    state.selection?.context === "chord"
      ? {
          ...state.selection,
          startPosition: Math.min(state.selection.startPosition, lastPosition),
          endPosition: Math.min(state.selection.endPosition, lastPosition),
        }
      : state.selection;
  return commit(state, score, cursor, selection);
}

function moveChord(
  state: EditorState,
  chordId: string,
  target: ChordPoint,
): EditorState {
  const targetMeasureIndex = state.score.measures.findIndex(
    (measure) => measure.id === target.measureId,
  );
  if (
    targetMeasureIndex < 0 ||
    !isValidChordPosition(target.position, state.score.timeSignature)
  ) {
    return state;
  }
  let sourceMeasureIndex = -1;
  let source: ChordDegreeEvent | undefined;
  for (
    let measureIndex = 0;
    measureIndex < state.score.measures.length;
    measureIndex += 1
  ) {
    const found = state.score.measures[measureIndex].chords.find(
      (chord) => chord.id === chordId,
    );
    if (found !== undefined) {
      source = found;
      sourceMeasureIndex = measureIndex;
      break;
    }
  }
  if (source === undefined || sourceMeasureIndex < 0) {
    return state;
  }
  if (source.measureId === target.measureId && source.position === target.position) {
    return state;
  }
  const movedChord = source;
  const measures = state.score.measures.map((measure, measureIndex) => {
    let chords = measure.chords;
    if (measureIndex === sourceMeasureIndex) {
      chords = chords.filter((chord) => chord.id !== chordId);
    }
    if (measureIndex === targetMeasureIndex) {
      chords = [
        ...chords.filter((chord) => chord.position !== target.position),
        { ...movedChord, measureId: target.measureId, position: target.position },
      ].sort((left, right) => left.position - right.position);
    }
    return chords === measure.chords ? measure : { ...measure, chords };
  });
  return commit(
    state,
    { ...state.score, measures },
    { context: "chord", ...target },
    null,
  );
}

function insertMeasure(
  state: EditorState,
  measureId: string,
  idFactory: IdFactory,
): EditorState {
  const index = getMeasureIndex(state.score, measureId);
  const measure = createEmptyMeasure(idFactory);
  const measures = [...state.score.measures];
  measures.splice(index + 1, 0, measure);
  return commit(
    state,
    { ...state.score, measures },
    { context: "melody", measureId: measure.id, symbolIndex: 0 },
    null,
  );
}

function deleteCurrentMeasure(state: EditorState, measureId: string): EditorState {
  const index = getMeasureIndex(state.score, measureId);
  if (state.score.measures.length === 1) {
    const measure = state.score.measures[0];
    if (measure.symbols.length === 0 && measure.chords.length === 0) {
      return state;
    }
    return commit(
      state,
      {
        ...state.score,
        measures: [{ ...measure, symbols: [], chords: [] }],
      },
      { context: "melody", measureId: measure.id, symbolIndex: 0 },
      null,
    );
  }
  const measures = state.score.measures.filter((measure) => measure.id !== measureId);
  const adjacent = measures[Math.min(index, measures.length - 1)];
  return commit(
    state,
    { ...state.score, measures },
    { context: "melody", measureId: adjacent.id, symbolIndex: 0 },
    null,
  );
}

function undo(state: EditorState): EditorState {
  const previous = state.history.past[state.history.past.length - 1];
  if (previous === undefined) {
    return state;
  }
  return {
    ...state,
    ...previous,
    history: {
      past: state.history.past.slice(0, -1),
      future: [snapshot(state), ...state.history.future],
    },
  };
}

function redo(state: EditorState): EditorState {
  const next = state.history.future[0];
  if (next === undefined) {
    return state;
  }
  return {
    ...state,
    ...next,
    history: {
      past: [...state.history.past, snapshot(state)].slice(-EDIT_HISTORY_LIMIT),
      future: state.history.future.slice(1),
    },
  };
}

function selectAll(state: EditorState): EditorState {
  if (state.cursor.context === "melody") {
    const measureIndex = assertMelodyPoint(state.score, state.cursor);
    return {
      ...state,
      selection: {
        context: "melody",
        measureId: state.cursor.measureId,
        start: 0,
        end: state.score.measures[measureIndex].symbols.length,
      },
    };
  }
  assertChordPoint(state.score, state.cursor);
  return {
    ...state,
    selection: {
      context: "chord",
      measureId: state.cursor.measureId,
      startPosition: 0,
      endPosition: getTimeSignatureCapacity(state.score.timeSignature) - 1,
    },
  };
}

function currentMeasureId(state: EditorState): string {
  return state.cursor.measureId;
}

export function reduceEditorState(
  state: EditorState,
  action: EditorAction,
  idFactory: IdFactory = generateEntityId,
): EditorState {
  switch (action.type) {
    case "set-cursor":
      if (action.cursor.context === "melody") {
        assertMelodyPoint(state.score, action.cursor);
      } else {
        assertChordPoint(state.score, action.cursor);
      }
      return { ...state, cursor: action.cursor, selection: null };
    case "set-selection": {
      const selection = normalizeSelection(state.score, action.selection);
      if (selection === null) {
        return { ...state, selection: null };
      }
      const cursor: EditorCursor =
        selection.context === "melody"
          ? {
              context: "melody",
              measureId: selection.measureId,
              symbolIndex: selection.end,
            }
          : {
              context: "chord",
              measureId: selection.measureId,
              position: selection.endPosition,
            };
      return { ...state, cursor, selection };
    }
    case "select-all":
      return selectAll(state);
    case "set-input":
      return { ...state, input: { ...state.input, ...action.changes } };
    case "input-degree":
      return inputDegree(state, action.degree, idFactory);
    case "input-rest":
      return state.cursor.context === "melody"
        ? insertMelodySymbol(
            state,
            createRest(
              { duration: state.input.duration, dotted: state.input.dotted },
              idFactory,
            ),
          )
        : state;
    case "update-selected-melody":
      return updateSelectedMelody(state, action.changes);
    case "set-score-metadata":
      return setScoreMetadata(state, action.changes);
    case "delete-backward":
      return deleteContent(state, true);
    case "delete-forward":
      return deleteContent(state, false);
    case "copy": {
      const clipboard = copySelection(state);
      return clipboard === null ? state : { ...state, clipboard };
    }
    case "cut": {
      const clipboard = copySelection(state);
      if (clipboard === null) {
        return state;
      }
      return deleteContent({ ...state, clipboard }, false);
    }
    case "paste":
      if (state.clipboard?.context === "melody") {
        return pasteMelody(state, state.clipboard, idFactory);
      }
      if (state.clipboard?.context === "chord") {
        return pasteChords(state, state.clipboard, idFactory);
      }
      return state;
    case "move-chord":
      return moveChord(state, action.chordId, action.target);
    case "insert-measure-after":
      return insertMeasure(
        state,
        action.measureId ?? currentMeasureId(state),
        idFactory,
      );
    case "delete-measure":
      return deleteCurrentMeasure(
        state,
        action.measureId ?? currentMeasureId(state),
      );
    case "undo":
      return undo(state);
    case "redo":
      return redo(state);
    case "replace-score":
      return {
        ...createEditorState(action.score),
        input: state.input,
        clipboard: state.clipboard,
        playback: state.playback,
        scroll: state.scroll,
      };
    case "set-playback":
      return { ...state, playback: action.playback };
    case "set-scroll":
      return { ...state, scroll: action.scroll };
  }
}

export function editorReducer(
  state: EditorState,
  action: EditorAction,
): EditorState {
  return reduceEditorState(state, action);
}

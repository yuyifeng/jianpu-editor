export const SCORE_FORMAT_VERSION = 1 as const;

export const TIME_SIGNATURES = ["2/4", "3/4", "4/4", "6/8"] as const;
export const DURATIONS = [
  "whole",
  "half",
  "quarter",
  "eighth",
  "eighth-triplet",
  "sixteenth",
] as const;
export const ACCIDENTALS = ["none", "sharp", "flat", "natural"] as const;
export const MODES = ["major", "natural-minor"] as const;
export const KEY_SIGNATURES = [
  "C",
  "C#/Db",
  "D",
  "D#/Eb",
  "E",
  "F",
  "F#/Gb",
  "G",
  "G#/Ab",
  "A",
  "A#/Bb",
  "B",
] as const;

export type TimeSignature = (typeof TIME_SIGNATURES)[number];
export type Duration = (typeof DURATIONS)[number];
export type Accidental = (typeof ACCIDENTALS)[number];
export type Mode = (typeof MODES)[number];
export type KeySignature = (typeof KEY_SIGNATURES)[number];
export type ScaleDegree = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Octave = -2 | -1 | 0 | 1 | 2;
export type ExtensionUnits = 0 | 1 | 2 | 3 | 4;
export type EntityKind = "score" | "measure" | "note" | "rest" | "chord";
export type IdFactory = (kind: EntityKind) => string;

interface TimedSymbol {
  readonly id: string;
  readonly duration: Duration;
  readonly dotted: boolean;
  readonly extension: ExtensionUnits;
}

export interface Note extends TimedSymbol {
  readonly kind: "note";
  readonly degree: ScaleDegree;
  readonly octave: Octave;
  readonly accidental: Accidental;
  readonly tieToNext: boolean;
}

export interface Rest extends TimedSymbol {
  readonly kind: "rest";
}

export type MelodySymbol = Note | Rest;

export interface ChordDegreeEvent {
  readonly id: string;
  readonly measureId: string;
  readonly degree: ScaleDegree;
  /**
   * Zero-based position measured in sixteenth-note units.
   * Chords can only start on an integer position inside the measure.
   */
  readonly position: number;
}

export interface Measure {
  readonly id: string;
  readonly symbols: readonly MelodySymbol[];
  readonly chords: readonly ChordDegreeEvent[];
}

export interface Score {
  readonly id: string;
  readonly title: string;
  readonly keySignature: KeySignature;
  readonly mode: Mode;
  readonly timeSignature: TimeSignature;
  readonly tempo: number;
  readonly measures: readonly Measure[];
}

export interface NoteInput {
  readonly degree: ScaleDegree;
  readonly duration?: Duration;
  readonly octave?: Octave;
  readonly accidental?: Accidental;
  readonly dotted?: boolean;
  readonly extension?: ExtensionUnits;
  readonly tieToNext?: boolean;
}

export interface RestInput {
  readonly duration?: Duration;
  readonly dotted?: boolean;
  readonly extension?: ExtensionUnits;
}

export type MeasureDurationStatus = "exact" | "underfilled" | "overfilled";

const DURATION_IN_SIXTEENTHS: Readonly<Record<Duration, number>> = {
  whole: 16,
  half: 8,
  quarter: 4,
  eighth: 2,
  "eighth-triplet": 4 / 3,
  sixteenth: 1,
};

const TIME_SIGNATURE_CAPACITY: Readonly<Record<TimeSignature, number>> = {
  "2/4": 8,
  "3/4": 12,
  "4/4": 16,
  "6/8": 12,
};

export function createSequentialIdFactory(namespace = "jianpu"): IdFactory {
  const counters: Record<EntityKind, number> = {
    score: 0,
    measure: 0,
    note: 0,
    rest: 0,
    chord: 0,
  };

  return (kind) => {
    counters[kind] += 1;
    return `${namespace}-${kind}-${counters[kind]}`;
  };
}

function createRandomToken(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  if (typeof cryptoApi?.getRandomValues === "function") {
    const values = new Uint32Array(4);
    cryptoApi.getRandomValues(values);
    return Array.from(values, (value) => value.toString(16).padStart(8, "0")).join(
      "",
    );
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export const generateEntityId: IdFactory = (kind) =>
  `${kind}-${createRandomToken()}`;

export function createNote(input: NoteInput, idFactory: IdFactory = generateEntityId): Note {
  return {
    id: idFactory("note"),
    kind: "note",
    degree: input.degree,
    duration: input.duration ?? "quarter",
    octave: input.octave ?? 0,
    accidental: input.accidental ?? "none",
    dotted: input.dotted ?? false,
    extension: input.extension ?? 0,
    tieToNext: input.tieToNext ?? false,
  };
}

export function createRest(
  input: RestInput = {},
  idFactory: IdFactory = generateEntityId,
): Rest {
  return {
    id: idFactory("rest"),
    kind: "rest",
    duration: input.duration ?? "quarter",
    dotted: input.dotted ?? false,
    extension: input.extension ?? 0,
  };
}

export function createEmptyMeasure(idFactory: IdFactory = generateEntityId): Measure {
  return {
    id: idFactory("measure"),
    symbols: [],
    chords: [],
  };
}

export function createEmptyScore(idFactory: IdFactory = generateEntityId): Score {
  return {
    id: idFactory("score"),
    title: "未命名歌曲",
    keySignature: "C",
    mode: "major",
    timeSignature: "4/4",
    tempo: 90,
    measures: [createEmptyMeasure(idFactory)],
  };
}

export function getTimeSignatureCapacity(timeSignature: TimeSignature): number {
  return TIME_SIGNATURE_CAPACITY[timeSignature];
}

export function getSymbolDuration(
  symbol: Pick<MelodySymbol, "duration" | "dotted" | "extension">,
): number {
  const baseDuration = DURATION_IN_SIXTEENTHS[symbol.duration];
  return (symbol.dotted ? baseDuration * 1.5 : baseDuration) + symbol.extension;
}

export function getMeasureDuration(measure: Measure): number {
  return measure.symbols.reduce((total, symbol) => total + getSymbolDuration(symbol), 0);
}

export function getMeasureDurationStatus(
  measure: Measure,
  timeSignature: TimeSignature,
): MeasureDurationStatus {
  const duration = getMeasureDuration(measure);
  const capacity = getTimeSignatureCapacity(timeSignature);

  if (duration === capacity) {
    return "exact";
  }

  return duration < capacity ? "underfilled" : "overfilled";
}

export function updateNote(
  note: Note,
  changes: Partial<
    Pick<
      Note,
      "degree" | "octave" | "accidental" | "duration" | "dotted" | "extension"
    >
  >,
): Note {
  return { ...note, ...changes };
}

export function updateSymbolDuration(
  symbol: MelodySymbol,
  duration: Duration,
  dotted = symbol.dotted,
): MelodySymbol {
  return { ...symbol, duration, dotted };
}

export function haveSamePitch(left: Note, right: Note): boolean {
  return (
    left.degree === right.degree &&
    left.octave === right.octave &&
    left.accidental === right.accidental
  );
}

export function setTieToNext(note: Note, nextNote: Note | undefined, tied: boolean): Note {
  if (tied && (nextNote === undefined || !haveSamePitch(note, nextNote))) {
    throw new RangeError("A tie requires an adjacent note with the same pitch.");
  }

  return { ...note, tieToNext: tied };
}

export function insertMeasureAfter(
  score: Score,
  measureId: string,
  idFactory: IdFactory = generateEntityId,
): Score {
  const index = score.measures.findIndex((measure) => measure.id === measureId);
  if (index < 0) {
    throw new RangeError(`Unknown measure: ${measureId}`);
  }

  const measures = [...score.measures];
  measures.splice(index + 1, 0, createEmptyMeasure(idFactory));
  return { ...score, measures };
}

export function deleteMeasure(score: Score, measureId: string): Score {
  const index = score.measures.findIndex((measure) => measure.id === measureId);
  if (index < 0) {
    throw new RangeError(`Unknown measure: ${measureId}`);
  }

  if (score.measures.length === 1) {
    return {
      ...score,
      measures: [{ ...score.measures[0], symbols: [], chords: [] }],
    };
  }

  return {
    ...score,
    measures: score.measures.filter((measure) => measure.id !== measureId),
  };
}

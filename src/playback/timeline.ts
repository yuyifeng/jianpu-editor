import {
  getMeasureDuration,
  getSymbolDuration,
  getTimeSignatureCapacity,
  mapChordDegreeToMidi,
  type EditorCursor,
  type KeySignature,
  type Mode,
  type Note,
  type Score,
} from "../domain";

export interface MelodyTimelineEvent {
  readonly symbolId: string;
  readonly measureId: string;
  readonly startUnits: number;
  readonly endUnits: number;
  readonly midi: number | null;
}

export interface MelodyVoiceEvent {
  readonly id: string;
  readonly startUnits: number;
  readonly endUnits: number;
  readonly midi: number;
}

export interface ChordTimelineEvent {
  readonly chordId: string;
  readonly measureId: string;
  readonly startUnits: number;
  readonly endUnits: number;
  readonly midi: readonly [number, number, number];
}

export interface PlaybackTimeline {
  readonly secondsPerUnit: number;
  readonly durationUnits: number;
  readonly durationSeconds: number;
  readonly melody: readonly MelodyTimelineEvent[];
  readonly melodyVoices: readonly MelodyVoiceEvent[];
  readonly chords: readonly ChordTimelineEvent[];
}

export interface PlaybackFrame {
  readonly symbolId?: string;
  readonly chordId?: string;
}

const KEY_PITCH_CLASS: Readonly<Record<KeySignature, number>> = {
  C: 0,
  "C#/Db": 1,
  D: 2,
  "D#/Eb": 3,
  E: 4,
  F: 5,
  "F#/Gb": 6,
  G: 7,
  "G#/Ab": 8,
  A: 9,
  "A#/Bb": 10,
  B: 11,
};

const TONIC_LETTER_INDEX: Readonly<Record<KeySignature, number>> = {
  C: 0,
  "C#/Db": 0,
  D: 1,
  "D#/Eb": 1,
  E: 2,
  F: 3,
  "F#/Gb": 3,
  G: 4,
  "G#/Ab": 4,
  A: 5,
  "A#/Bb": 5,
  B: 6,
};

const NATURAL_PITCH_CLASSES = [0, 2, 4, 5, 7, 9, 11] as const;

const SCALE_INTERVALS: Readonly<Record<Mode, readonly number[]>> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  "natural-minor": [0, 2, 3, 5, 7, 8, 10],
};

function accidentalOffset(
  note: Note,
  keySignature: KeySignature,
  diatonicMidi: number,
): number {
  if (note.accidental === "sharp") {
    return 1;
  }
  if (note.accidental === "flat") {
    return -1;
  }
  if (note.accidental !== "natural") {
    return 0;
  }

  const tonicLetter = TONIC_LETTER_INDEX[keySignature];
  const absoluteLetter = tonicLetter + note.degree - 1;
  const naturalPitchClass =
    NATURAL_PITCH_CLASSES[absoluteLetter % NATURAL_PITCH_CLASSES.length];
  const diatonicPitchClass = ((diatonicMidi % 12) + 12) % 12;
  let offset = naturalPitchClass - diatonicPitchClass;
  if (offset > 6) {
    offset -= 12;
  } else if (offset < -6) {
    offset += 12;
  }
  return offset;
}

export function mapNoteToMidi(
  note: Note,
  keySignature: KeySignature,
  mode: Mode,
  tonicOctave = 4,
): number {
  const tonicMidi = (tonicOctave + 1) * 12 + KEY_PITCH_CLASS[keySignature];
  const diatonicMidi =
    tonicMidi +
    SCALE_INTERVALS[mode][note.degree - 1] +
    note.octave * 12;
  const midi =
    diatonicMidi + accidentalOffset(note, keySignature, diatonicMidi);

  if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
    throw new RangeError("Mapped note falls outside the MIDI note range.");
  }
  return midi;
}

function createMelodyVoices(
  melody: readonly MelodyTimelineEvent[],
  notesById: ReadonlyMap<string, Note>,
): MelodyVoiceEvent[] {
  const voices: MelodyVoiceEvent[] = [];

  for (let index = 0; index < melody.length; index += 1) {
    const event = melody[index];
    if (event.midi === null) {
      continue;
    }

    let endUnits = event.endUnits;
    let tiedEvent = event;
    let tiedNote = notesById.get(event.symbolId);
    while (tiedNote?.tieToNext) {
      const next = melody[index + 1];
      if (
        next === undefined ||
        next.midi !== event.midi ||
        next.startUnits !== tiedEvent.endUnits
      ) {
        break;
      }
      index += 1;
      tiedEvent = next;
      tiedNote = notesById.get(next.symbolId);
      endUnits = next.endUnits;
    }

    voices.push({
      id: `melody:${event.symbolId}`,
      startUnits: event.startUnits,
      endUnits,
      midi: event.midi,
    });
  }

  return voices;
}

function getMeasureStarts(score: Score): number[] {
  const capacity = getTimeSignatureCapacity(score.timeSignature);
  const starts: number[] = [];
  let nextStart = 0;
  for (const measure of score.measures) {
    starts.push(nextStart);
    nextStart += Math.max(capacity, getMeasureDuration(measure));
  }
  return starts;
}

export function buildPlaybackTimeline(score: Score): PlaybackTimeline {
  const capacity = getTimeSignatureCapacity(score.timeSignature);
  const secondsPerUnit = 60 / score.tempo / 4;
  const melody: MelodyTimelineEvent[] = [];
  const notesById = new Map<string, Note>();
  const measureStarts = getMeasureStarts(score);
  let durationUnits = measureStarts.reduce(
    (end, start, index) =>
      Math.max(
        end,
        start +
          Math.max(capacity, getMeasureDuration(score.measures[index])),
      ),
    0,
  );

  score.measures.forEach((measure, measureIndex) => {
    const measureStart = measureStarts[measureIndex];
    let offset = 0;
    for (const symbol of measure.symbols) {
      const startUnits = measureStart + offset;
      const endUnits = startUnits + getSymbolDuration(symbol);
      const note = symbol.kind === "note" ? symbol : null;
      if (note !== null) {
        notesById.set(note.id, note);
      }
      melody.push({
        symbolId: symbol.id,
        measureId: measure.id,
        startUnits,
        endUnits,
        midi:
          note === null
            ? null
            : mapNoteToMidi(note, score.keySignature, score.mode),
      });
      offset += getSymbolDuration(symbol);
      durationUnits = Math.max(durationUnits, endUnits);
    }
  });

  melody.sort(
    (left, right) =>
      left.startUnits - right.startUnits || left.endUnits - right.endUnits,
  );

  const chordMarkers = score.measures
    .flatMap((measure, measureIndex) =>
      measure.chords.map((chord) => ({
        chord,
        startUnits: measureStarts[measureIndex] + chord.position,
      })),
    )
    .sort(
      (left, right) =>
        left.startUnits - right.startUnits ||
        left.chord.id.localeCompare(right.chord.id),
    );

  const chords = chordMarkers.map<ChordTimelineEvent>((marker, index) => ({
    chordId: marker.chord.id,
    measureId: marker.chord.measureId,
    startUnits: marker.startUnits,
    endUnits: chordMarkers[index + 1]?.startUnits ?? durationUnits,
    midi: mapChordDegreeToMidi(
      score.keySignature,
      score.mode,
      marker.chord.degree,
      3,
    ),
  }));

  return {
    secondsPerUnit,
    durationUnits,
    durationSeconds: durationUnits * secondsPerUnit,
    melody,
    melodyVoices: createMelodyVoices(melody, notesById),
    chords,
  };
}

export function unitsToSeconds(
  timeline: Pick<PlaybackTimeline, "secondsPerUnit">,
  units: number,
): number {
  return units * timeline.secondsPerUnit;
}

export function getCursorStartUnits(
  score: Score,
  cursor: EditorCursor,
): number {
  const measureIndex = score.measures.findIndex(
    (measure) => measure.id === cursor.measureId,
  );
  if (measureIndex < 0) {
    return 0;
  }

  if (cursor.context === "chord") {
    return getMeasureStarts(score)[measureIndex] + cursor.position;
  }

  const measure = score.measures[measureIndex];
  const offset = measure.symbols
    .slice(0, cursor.symbolIndex)
    .reduce((total, symbol) => total + getSymbolDuration(symbol), 0);
  return getMeasureStarts(score)[measureIndex] + offset;
}

export function getPlaybackStartSeconds(
  timeline: PlaybackTimeline,
  score: Score,
  cursor: EditorCursor,
): number {
  const cursorUnits = getCursorStartUnits(score, cursor);
  const startUnits =
    cursorUnits >= timeline.durationUnits ? 0 : Math.max(0, cursorUnits);
  return unitsToSeconds(timeline, startUnits);
}

export function getPlaybackFrame(
  timeline: PlaybackTimeline,
  positionSeconds: number,
): PlaybackFrame {
  const positionUnits = positionSeconds / timeline.secondsPerUnit;
  let melody: MelodyTimelineEvent | undefined;
  for (let index = timeline.melody.length - 1; index >= 0; index -= 1) {
    const event = timeline.melody[index];
    if (
      event.startUnits <= positionUnits &&
      positionUnits < event.endUnits
    ) {
      melody = event;
      break;
    }
  }
  let chord: ChordTimelineEvent | undefined;
  for (let index = timeline.chords.length - 1; index >= 0; index -= 1) {
    const event = timeline.chords[index];
    if (
      event.startUnits <= positionUnits &&
      positionUnits < event.endUnits
    ) {
      chord = event;
      break;
    }
  }

  return {
    ...(melody === undefined ? {} : { symbolId: melody.symbolId }),
    ...(chord === undefined ? {} : { chordId: chord.chordId }),
  };
}

export function hasPlaybackContent(timeline: PlaybackTimeline): boolean {
  return timeline.melody.length > 0 || timeline.chords.length > 0;
}

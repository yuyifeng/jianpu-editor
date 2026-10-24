import {
  generateEntityId,
  getTimeSignatureCapacity,
  type ChordDegreeEvent,
  type IdFactory,
  type KeySignature,
  type Measure,
  type Mode,
  type ScaleDegree,
  type TimeSignature,
} from "./score";

export type ChordQuality = "major" | "minor" | "diminished";
export type MidiTriad = readonly [number, number, number];

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

const SCALE_INTERVALS: Readonly<Record<Mode, readonly number[]>> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  "natural-minor": [0, 2, 3, 5, 7, 8, 10],
};

const CHORD_QUALITIES: Readonly<Record<Mode, readonly ChordQuality[]>> = {
  major: ["major", "minor", "minor", "major", "major", "minor", "diminished"],
  "natural-minor": [
    "minor",
    "diminished",
    "major",
    "minor",
    "minor",
    "major",
    "major",
  ],
};

const TRIAD_INTERVALS: Readonly<Record<ChordQuality, MidiTriad>> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
};

export function isValidChordPosition(position: number, timeSignature: TimeSignature): boolean {
  return (
    Number.isInteger(position) &&
    position >= 0 &&
    position < getTimeSignatureCapacity(timeSignature)
  );
}

export function createChordDegreeEvent(
  measureId: string,
  degree: ScaleDegree,
  position: number,
  timeSignature: TimeSignature,
  idFactory: IdFactory = generateEntityId,
): ChordDegreeEvent {
  if (!isValidChordPosition(position, timeSignature)) {
    throw new RangeError(`Chord position ${position} is outside ${timeSignature}.`);
  }

  return {
    id: idFactory("chord"),
    measureId,
    degree,
    position,
  };
}

export function upsertChordDegreeEvent(
  measure: Measure,
  degree: ScaleDegree,
  position: number,
  timeSignature: TimeSignature,
  idFactory: IdFactory = generateEntityId,
): Measure {
  if (!isValidChordPosition(position, timeSignature)) {
    throw new RangeError(`Chord position ${position} is outside ${timeSignature}.`);
  }

  const existingIndex = measure.chords.findIndex((chord) => chord.position === position);
  if (existingIndex < 0) {
    return {
      ...measure,
      chords: [
        ...measure.chords,
        createChordDegreeEvent(measure.id, degree, position, timeSignature, idFactory),
      ],
    };
  }

  const chords = [...measure.chords];
  chords[existingIndex] = { ...chords[existingIndex], degree };
  return { ...measure, chords };
}

export function getChordQuality(mode: Mode, degree: ScaleDegree): ChordQuality {
  return CHORD_QUALITIES[mode][degree - 1];
}

export function mapChordDegreeToMidi(
  keySignature: KeySignature,
  mode: Mode,
  degree: ScaleDegree,
  tonicOctave = 4,
): MidiTriad {
  if (!Number.isInteger(tonicOctave) || tonicOctave < -1 || tonicOctave > 8) {
    throw new RangeError("Tonic octave must be an integer from -1 through 8.");
  }

  const tonicMidi = (tonicOctave + 1) * 12 + KEY_PITCH_CLASS[keySignature];
  const rootMidi = tonicMidi + SCALE_INTERVALS[mode][degree - 1];
  const quality = getChordQuality(mode, degree);
  const [root, third, fifth] = TRIAD_INTERVALS[quality].map(
    (interval) => rootMidi + interval,
  ) as [number, number, number];

  if (root < 0 || fifth > 127) {
    throw new RangeError("Mapped chord falls outside the MIDI note range.");
  }

  return [root, third, fifth];
}

export interface PianoSampleAnchor {
  readonly midi: number;
  readonly name: string;
  readonly fileName: string;
}

export interface PianoSampleMapping {
  readonly anchor: PianoSampleAnchor;
  readonly playbackRate: number;
}

export const PIANO_SAMPLE_ANCHORS: readonly PianoSampleAnchor[] = [
  { midi: 48, name: "C3", fileName: "C3.mp3" },
  { midi: 51, name: "D#3", fileName: "Ds3.mp3" },
  { midi: 54, name: "F#3", fileName: "Fs3.mp3" },
  { midi: 57, name: "A3", fileName: "A3.mp3" },
  { midi: 60, name: "C4", fileName: "C4.mp3" },
  { midi: 63, name: "D#4", fileName: "Ds4.mp3" },
  { midi: 66, name: "F#4", fileName: "Fs4.mp3" },
  { midi: 69, name: "A4", fileName: "A4.mp3" },
  { midi: 72, name: "C5", fileName: "C5.mp3" },
  { midi: 75, name: "D#5", fileName: "Ds5.mp3" },
  { midi: 78, name: "F#5", fileName: "Fs5.mp3" },
  { midi: 81, name: "A5", fileName: "A5.mp3" },
  { midi: 84, name: "C6", fileName: "C6.mp3" },
] as const;

export function getPianoSampleMapping(midi: number): PianoSampleMapping {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
    throw new RangeError(`MIDI note must be an integer from 0 to 127: ${midi}`);
  }

  const anchor = PIANO_SAMPLE_ANCHORS.reduce((nearest, candidate) =>
    Math.abs(candidate.midi - midi) < Math.abs(nearest.midi - midi)
      ? candidate
      : nearest,
  );

  return {
    anchor,
    playbackRate: 2 ** ((midi - anchor.midi) / 12),
  };
}

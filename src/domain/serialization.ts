import { isValidChordPosition } from "./chords";
import {
  ACCIDENTALS,
  DURATIONS,
  KEY_SIGNATURES,
  MODES,
  SCORE_FORMAT_VERSION,
  TIME_SIGNATURES,
  type ChordDegreeEvent,
  type Score,
} from "./score";

export const SCORE_DOCUMENT_FORMAT = "jianpu-editor" as const;

export interface ScoreDocument {
  readonly format: typeof SCORE_DOCUMENT_FORMAT;
  readonly version: typeof SCORE_FORMAT_VERSION;
  readonly score: Score;
}

export type ScoreDocumentErrorCode =
  | "INVALID_JSON"
  | "INVALID_STRUCTURE"
  | "UNSUPPORTED_VERSION";

export interface ScoreDocumentError {
  readonly code: ScoreDocumentErrorCode;
  readonly message: string;
}

export type ScoreDocumentResult =
  | { readonly ok: true; readonly value: ScoreDocument }
  | { readonly ok: false; readonly error: ScoreDocumentError };

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf(value: unknown, candidates: readonly unknown[]): boolean {
  return candidates.includes(value);
}

function isNonEmptyId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isScaleDegree(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 7;
}

function validateTimedSymbol(value: JsonObject, path: string): string | null {
  if (!isNonEmptyId(value.id)) {
    return `${path}.id must be a non-empty string.`;
  }

  if (!isOneOf(value.duration, DURATIONS)) {
    return `${path}.duration is invalid.`;
  }

  if (typeof value.dotted !== "boolean") {
    return `${path}.dotted must be a boolean.`;
  }

  if (
    value.extension !== undefined &&
    (!Number.isInteger(value.extension) ||
      Number(value.extension) < 0 ||
      Number(value.extension) > 4)
  ) {
    return `${path}.extension must be an integer from 0 through 4.`;
  }

  return null;
}

function validateMelodySymbol(value: unknown, path: string): string | null {
  if (!isObject(value)) {
    return `${path} must be an object.`;
  }

  const timedSymbolError = validateTimedSymbol(value, path);
  if (timedSymbolError !== null) {
    return timedSymbolError;
  }

  if (value.kind === "rest") {
    return null;
  }

  if (value.kind !== "note") {
    return `${path}.kind must be "note" or "rest".`;
  }

  if (!isScaleDegree(value.degree)) {
    return `${path}.degree must be an integer from 1 through 7.`;
  }

  if (
    !Number.isInteger(value.octave) ||
    Number(value.octave) < -2 ||
    Number(value.octave) > 2
  ) {
    return `${path}.octave must be an integer from -2 through 2.`;
  }

  if (!isOneOf(value.accidental, ACCIDENTALS)) {
    return `${path}.accidental is invalid.`;
  }

  if (typeof value.tieToNext !== "boolean") {
    return `${path}.tieToNext must be a boolean.`;
  }

  return null;
}

function validateChord(
  value: unknown,
  measureId: string,
  timeSignature: Score["timeSignature"],
  path: string,
): string | null {
  if (!isObject(value)) {
    return `${path} must be an object.`;
  }

  if (!isNonEmptyId(value.id)) {
    return `${path}.id must be a non-empty string.`;
  }

  if (value.measureId !== measureId) {
    return `${path}.measureId must match its containing measure.`;
  }

  if (!isScaleDegree(value.degree)) {
    return `${path}.degree must be an integer from 1 through 7.`;
  }

  if (
    typeof value.position !== "number" ||
    !isValidChordPosition(value.position, timeSignature)
  ) {
    return `${path}.position must be a valid sixteenth-note position.`;
  }

  return null;
}

function validateMeasure(
  value: unknown,
  timeSignature: Score["timeSignature"],
  path: string,
): string | null {
  if (!isObject(value) || !isNonEmptyId(value.id)) {
    return `${path}.id must be a non-empty string.`;
  }

  if (!Array.isArray(value.symbols)) {
    return `${path}.symbols must be an array.`;
  }

  for (let index = 0; index < value.symbols.length; index += 1) {
    const error = validateMelodySymbol(value.symbols[index], `${path}.symbols[${index}]`);
    if (error !== null) {
      return error;
    }
  }

  if (!Array.isArray(value.chords)) {
    return `${path}.chords must be an array.`;
  }

  const occupiedPositions = new Set<number>();
  for (let index = 0; index < value.chords.length; index += 1) {
    const chord = value.chords[index];
    const error = validateChord(chord, value.id, timeSignature, `${path}.chords[${index}]`);
    if (error !== null) {
      return error;
    }

    const position = (chord as ChordDegreeEvent).position;
    if (occupiedPositions.has(position)) {
      return `${path}.chords cannot contain multiple events at position ${position}.`;
    }
    occupiedPositions.add(position);
  }

  return null;
}

function findDuplicateId(score: Score): string | null {
  const ids = new Set<string>();
  const allIds = [
    score.id,
    ...score.measures.flatMap((measure) => [
      measure.id,
      ...measure.symbols.map((symbol) => symbol.id),
      ...measure.chords.map((chord) => chord.id),
    ]),
  ];

  for (const id of allIds) {
    if (ids.has(id)) {
      return id;
    }
    ids.add(id);
  }

  return null;
}

function validateScore(value: unknown): string | null {
  if (!isObject(value)) {
    return "score must be an object.";
  }

  if (!isNonEmptyId(value.id)) {
    return "score.id must be a non-empty string.";
  }

  if (typeof value.title !== "string") {
    return "score title must be a string.";
  }

  if (!isOneOf(value.keySignature, KEY_SIGNATURES)) {
    return "score.keySignature is invalid.";
  }

  if (!isOneOf(value.mode, MODES)) {
    return "score.mode is invalid.";
  }

  if (!isOneOf(value.timeSignature, TIME_SIGNATURES)) {
    return "score.timeSignature is invalid.";
  }

  if (
    !Number.isInteger(value.tempo) ||
    Number(value.tempo) < 30 ||
    Number(value.tempo) > 240
  ) {
    return "score.tempo must be an integer from 30 through 240.";
  }

  if (!Array.isArray(value.measures) || value.measures.length === 0) {
    return "score.measures must contain at least one measure.";
  }

  const timeSignature = value.timeSignature as Score["timeSignature"];
  for (let index = 0; index < value.measures.length; index += 1) {
    const error = validateMeasure(
      value.measures[index],
      timeSignature,
      `score.measures[${index}]`,
    );
    if (error !== null) {
      return error;
    }
  }

  const duplicateId = findDuplicateId(value as unknown as Score);
  if (duplicateId !== null) {
    return `All entity IDs must be unique; duplicate "${duplicateId}" found.`;
  }

  return null;
}

function normalizeScore(value: unknown): Score {
  const score = value as Score;
  return {
    id: score.id,
    title: score.title,
    keySignature: score.keySignature,
    mode: score.mode,
    timeSignature: score.timeSignature,
    tempo: score.tempo,
    measures: score.measures.map((measure) => ({
      id: measure.id,
      symbols: measure.symbols.map((symbol) =>
        symbol.kind === "rest"
          ? {
              id: symbol.id,
              kind: symbol.kind,
              duration: symbol.duration,
              dotted: symbol.dotted,
              extension: symbol.extension ?? 0,
            }
          : {
              id: symbol.id,
              kind: symbol.kind,
              degree: symbol.degree,
              duration: symbol.duration,
              octave: symbol.octave,
              accidental: symbol.accidental,
              dotted: symbol.dotted,
              extension: symbol.extension ?? 0,
              tieToNext: symbol.tieToNext,
            },
      ),
      chords: measure.chords.map((chord) => ({
        id: chord.id,
        measureId: chord.measureId,
        degree: chord.degree,
        position: chord.position,
      })),
    })),
  };
}

export function isCompatibleScoreVersion(version: unknown): boolean {
  return version === SCORE_FORMAT_VERSION;
}

export function validateScoreDocument(value: unknown): ScoreDocumentResult {
  if (!isObject(value)) {
    return {
      ok: false,
      error: { code: "INVALID_STRUCTURE", message: "Document must be an object." },
    };
  }

  if (value.format !== SCORE_DOCUMENT_FORMAT) {
    return {
      ok: false,
      error: {
        code: "INVALID_STRUCTURE",
        message: `Document format must be "${SCORE_DOCUMENT_FORMAT}".`,
      },
    };
  }

  if (typeof value.version !== "number") {
    return {
      ok: false,
      error: {
        code: "INVALID_STRUCTURE",
        message: "Document version must be a number.",
      },
    };
  }

  if (!isCompatibleScoreVersion(value.version)) {
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED_VERSION",
        message: `Score document version ${value.version} is not supported.`,
      },
    };
  }

  const scoreError = validateScore(value.score);
  if (scoreError !== null) {
    return {
      ok: false,
      error: { code: "INVALID_STRUCTURE", message: scoreError },
    };
  }

  return {
    ok: true,
    value: {
      format: SCORE_DOCUMENT_FORMAT,
      version: SCORE_FORMAT_VERSION,
      score: normalizeScore(value.score),
    },
  };
}

export function parseScoreDocument(json: string): ScoreDocumentResult {
  let value: unknown;

  try {
    value = JSON.parse(json);
  } catch {
    return {
      ok: false,
      error: { code: "INVALID_JSON", message: "File is not valid JSON." },
    };
  }

  return validateScoreDocument(value);
}

export function serializeScore(score: Score): string {
  const document: ScoreDocument = {
    format: SCORE_DOCUMENT_FORMAT,
    version: SCORE_FORMAT_VERSION,
    score,
  };

  return JSON.stringify(document, null, 2);
}

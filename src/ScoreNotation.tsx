import {
  Fragment,
  useEffect,
  useRef,
  type Dispatch,
} from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";

import {
  getMeasureDuration,
  getMeasureDurationStatus,
  getTimeSignatureCapacity,
  type ChordPoint,
  type EditorAction,
  type EditorState,
  type Measure,
  type MelodySymbol,
} from "./domain";

interface ScoreNotationProps {
  readonly state: EditorState;
  readonly dispatch: Dispatch<EditorAction>;
  readonly movingChordId: string | null;
  readonly onMoveChord: (target: ChordPoint) => void;
}

interface SymbolViewProps {
  readonly symbol: MelodySymbol;
  readonly symbolIndex: number;
  readonly measureId: string;
  readonly selected: boolean;
  readonly playing: boolean;
  readonly onSelect: (extend: boolean) => void;
}

const ACCIDENTAL_LABELS = {
  none: "",
  sharp: "♯",
  flat: "♭",
  natural: "♮",
} as const;

const DURATION_LABELS = {
  whole: "全音符",
  half: "二分音符",
  quarter: "四分音符",
  eighth: "八分音符",
  "eighth-triplet": "三连音，三个音合计一拍",
  sixteenth: "十六分音符",
} as const;

const EXTENSION_LABELS = ["", "1/4", "1/2", "3/4", "1"] as const;

const STATUS_LABELS = {
  exact: "时值正确",
  underfilled: "时值不足",
  overfilled: "时值超出",
} as const;

function OctaveDots({
  count,
  position,
}: {
  readonly count: number;
  readonly position: "high" | "low";
}) {
  if (count === 0) {
    return null;
  }

  return (
    <span className={`octave-dots octave-dots-${position}`} aria-hidden="true">
      {"•".repeat(count)}
    </span>
  );
}

function DurationMarks({ symbol }: { readonly symbol: MelodySymbol }) {
  const lineCount =
    symbol.duration === "eighth" || symbol.duration === "eighth-triplet"
      ? 1
      : symbol.duration === "sixteenth"
        ? 2
        : 0;
  const sustainCount =
    symbol.duration === "whole" ? 3 : symbol.duration === "half" ? 1 : 0;
  const extensionMark =
    symbol.extension === 0 ? "" : `—${EXTENSION_LABELS[symbol.extension]}`;

  return (
    <>
      {lineCount > 0 && (
        <span className={`duration-lines duration-lines-${lineCount}`} aria-hidden="true">
          {Array.from({ length: lineCount }, (_, index) => (
            <i key={index} />
          ))}
        </span>
      )}
      {sustainCount > 0 && (
        <span className="sustain-marks" aria-hidden="true">
          {"—".repeat(sustainCount)}
        </span>
      )}
      {extensionMark !== "" && (
        <span className="extension-mark" aria-hidden="true">
          {extensionMark}
        </span>
      )}
      {symbol.duration === "eighth-triplet" && (
        <span className="triplet-mark" aria-hidden="true">
          3
        </span>
      )}
    </>
  );
}

function getSymbolLabel(symbol: MelodySymbol): string {
  const duration = DURATION_LABELS[symbol.duration];
  const dotted = symbol.dotted ? "，附点" : "";
  const extension =
    symbol.extension === 0
      ? ""
      : `，额外延长 ${EXTENSION_LABELS[symbol.extension]} 拍`;
  if (symbol.kind === "rest") {
    return `休止符，${duration}${dotted}${extension}`;
  }

  const accidental =
    symbol.accidental === "none" ? "" : `，${ACCIDENTAL_LABELS[symbol.accidental]}`;
  const octave =
    symbol.octave === 0
      ? ""
      : `，${symbol.octave > 0 ? "高" : "低"}${Math.abs(symbol.octave)}个八度`;
  return `${symbol.degree}，${duration}${octave}${accidental}${dotted}${extension}`;
}

function SymbolView({
  symbol,
  symbolIndex,
  measureId,
  selected,
  playing,
  onSelect,
}: SymbolViewProps) {
  const note = symbol.kind === "note" ? symbol : null;
  const octave = note?.octave ?? 0;

  return (
    <div
      className={[
        "symbol-cell",
        selected ? "is-selected" : "",
        playing ? "is-playing" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="gridcell"
    >
      <button
        className="symbol-button"
        type="button"
        aria-label={`${getSymbolLabel(symbol)}，第 ${symbolIndex + 1} 个符号`}
        aria-pressed={selected}
        data-measure-id={measureId}
        data-symbol-id={symbol.id}
        onClick={(event) => onSelect(event.shiftKey)}
      >
        <span className="notation" aria-hidden="true">
          <OctaveDots count={Math.max(0, octave)} position="high" />
          <span className="notation-main">
            {note !== null && note.accidental !== "none" && (
              <span className="accidental">{ACCIDENTAL_LABELS[note.accidental]}</span>
            )}
            <span className="degree">{note?.degree ?? "0"}</span>
            {symbol.dotted && <span className="augmentation-dot">·</span>}
            <DurationMarks symbol={symbol} />
          </span>
          <OctaveDots count={Math.max(0, -octave)} position="low" />
          {note?.tieToNext && <span className="tie-arc" />}
        </span>
      </button>
    </div>
  );
}

function isSymbolSelected(
  state: EditorState,
  measureId: string,
  symbolIndex: number,
): boolean {
  const selection = state.selection;
  return (
    selection?.context === "melody" &&
    selection.measureId === measureId &&
    symbolIndex >= selection.start &&
    symbolIndex < selection.end
  );
}

function isCursorAt(
  state: EditorState,
  measureId: string,
  symbolIndex: number,
): boolean {
  return (
    state.cursor.context === "melody" &&
    state.cursor.measureId === measureId &&
    state.cursor.symbolIndex === symbolIndex &&
    state.selection === null
  );
}

function isChordPositionSelected(
  state: EditorState,
  measureId: string,
  position: number,
): boolean {
  const selection = state.selection;
  return (
    selection?.context === "chord" &&
    selection.measureId === measureId &&
    position >= selection.startPosition &&
    position <= selection.endPosition
  );
}

function ChordLane({
  measure,
  measureIndex,
  state,
  movingChordId,
  onSelectPosition,
  onMoveChord,
}: {
  readonly measure: Measure;
  readonly measureIndex: number;
  readonly state: EditorState;
  readonly movingChordId: string | null;
  readonly onSelectPosition: (
    measureId: string,
    position: number,
    extend: boolean,
  ) => void;
  readonly onMoveChord: (target: ChordPoint) => void;
}) {
  const capacity = getTimeSignatureCapacity(state.score.timeSignature);
  const beatUnit = state.score.timeSignature === "6/8" ? 2 : 4;

  return (
    <div className="chord-lane">
      <span className="chord-lane-caption" aria-hidden="true">
        和弦
      </span>
      <div
        className="chord-position-grid"
        role="group"
        aria-label={`第 ${measureIndex + 1} 小节和弦轨，共 ${capacity} 个十六分拍位`}
        style={{
          gridTemplateColumns: `repeat(${capacity}, minmax(18px, 1fr))`,
        }}
      >
        {Array.from({ length: capacity }, (_, position) => {
          const chord = measure.chords.find(
            (candidate) => candidate.position === position,
          );
          const selected = isChordPositionSelected(
            state,
            measure.id,
            position,
          );
          const current =
            state.cursor.context === "chord" &&
            state.cursor.measureId === measure.id &&
            state.cursor.position === position &&
            state.selection === null;
          const movingSource = chord?.id === movingChordId;
          const playing =
            chord !== undefined && chord.id === state.playback.chordId;
          const label =
            chord === undefined
              ? `第 ${measureIndex + 1} 小节，第 ${position + 1} 个十六分拍位，空`
              : `第 ${measureIndex + 1} 小节，第 ${position + 1} 个十六分拍位，和弦级数 ${chord.degree}`;

          return (
            <button
              className={[
                "chord-position",
                position % beatUnit === 0 ? "is-beat-start" : "",
                chord === undefined ? "" : "has-chord",
                selected ? "is-selected" : "",
                current ? "is-current" : "",
                movingSource ? "is-moving-source" : "",
                movingChordId === null ? "" : "is-move-target",
                playing ? "is-playing" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              type="button"
              aria-label={label}
              aria-pressed={selected}
              data-chord-id={chord?.id}
              title={
                movingChordId === null
                  ? `${label}；点击选择，Shift 点击连续选择`
                  : `${label}；点击设为移动目标`
              }
              key={position}
              onClick={(event) => {
                if (movingChordId !== null) {
                  onMoveChord({ measureId: measure.id, position });
                  return;
                }
                onSelectPosition(measure.id, position, event.shiftKey);
              }}
            >
              <span aria-hidden="true">{chord?.degree ?? ""}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MeasureView({
  measure,
  measureIndex,
  state,
  dispatch,
  onSelectSymbol,
  movingChordId,
  onSelectChordPosition,
  onMoveChord,
}: {
  readonly measure: Measure;
  readonly measureIndex: number;
  readonly state: EditorState;
  readonly dispatch: Dispatch<EditorAction>;
  readonly onSelectSymbol: (
    measureId: string,
    symbolIndex: number,
    extend: boolean,
  ) => void;
  readonly movingChordId: string | null;
  readonly onSelectChordPosition: (
    measureId: string,
    position: number,
    extend: boolean,
  ) => void;
  readonly onMoveChord: (target: ChordPoint) => void;
}) {
  const duration = getMeasureDuration(measure);
  const capacity = getTimeSignatureCapacity(state.score.timeSignature);
  const status = getMeasureDurationStatus(measure, state.score.timeSignature);
  const active = state.cursor.measureId === measure.id;

  return (
    <section
      className={`measure ${active ? "is-active" : ""} duration-${status}`}
      aria-label={`第 ${measureIndex + 1} 小节，${STATUS_LABELS[status]}`}
    >
      <div className="measure-topline">
        <span className="measure-number">第 {measureIndex + 1} 小节</span>
        <span
          className="duration-status"
          title={`${STATUS_LABELS[status]}：${duration}/${capacity} 个十六分时值`}
        >
          {status !== "exact" && <AlertTriangle aria-hidden="true" size={12} />}
          {duration}/{capacity}
        </span>
        <span className="measure-actions">
          <button
            type="button"
            title="在此小节后新增"
            aria-label={`在第 ${measureIndex + 1} 小节后新增小节`}
            onClick={() =>
              dispatch({ type: "insert-measure-after", measureId: measure.id })
            }
          >
            <Plus aria-hidden="true" size={14} />
          </button>
          <button
            type="button"
            title={state.score.measures.length === 1 ? "清空小节" : "删除小节"}
            aria-label={
              state.score.measures.length === 1
                ? "清空唯一小节"
                : `删除第 ${measureIndex + 1} 小节`
            }
            onClick={() =>
              dispatch({ type: "delete-measure", measureId: measure.id })
            }
          >
            <Trash2 aria-hidden="true" size={13} />
          </button>
        </span>
      </div>

      <ChordLane
        measure={measure}
        measureIndex={measureIndex}
        state={state}
        movingChordId={movingChordId}
        onSelectPosition={onSelectChordPosition}
        onMoveChord={onMoveChord}
      />

      <div className="melody-row" role="grid" aria-label={`第 ${measureIndex + 1} 小节旋律`}>
        {measure.symbols.map((symbol, symbolIndex) => (
          <Fragment key={symbol.id}>
            <button
              className={`cursor-slot ${
                isCursorAt(state, measure.id, symbolIndex) ? "is-current" : ""
              }`}
              type="button"
              aria-label={`将光标置于第 ${measureIndex + 1} 小节第 ${
                symbolIndex + 1
              } 个符号之前`}
              onClick={() =>
                dispatch({
                  type: "set-cursor",
                  cursor: {
                    context: "melody",
                    measureId: measure.id,
                    symbolIndex,
                  },
                })
              }
            />
            <SymbolView
              symbol={symbol}
              symbolIndex={symbolIndex}
              measureId={measure.id}
              selected={isSymbolSelected(state, measure.id, symbolIndex)}
              playing={state.playback.symbolId === symbol.id}
              onSelect={(extend) =>
                onSelectSymbol(measure.id, symbolIndex, extend)
              }
            />
          </Fragment>
        ))}
        <button
          className={`cursor-slot ${
            isCursorAt(state, measure.id, measure.symbols.length)
              ? "is-current"
              : ""
          }`}
          type="button"
          aria-label={`将光标置于第 ${measureIndex + 1} 小节末尾`}
          onClick={() =>
            dispatch({
              type: "set-cursor",
              cursor: {
                context: "melody",
                measureId: measure.id,
                symbolIndex: measure.symbols.length,
              },
            })
          }
        />
        {measure.symbols.length === 0 && (
          <button
            className="empty-measure"
            type="button"
            onClick={() =>
              dispatch({
                type: "set-cursor",
                cursor: {
                  context: "melody",
                  measureId: measure.id,
                  symbolIndex: 0,
                },
              })
            }
          >
            按 1-7 或 0 录入
          </button>
        )}
      </div>
      <span className="bar-line" aria-hidden="true" />
    </section>
  );
}

export function ScoreNotation({
  state,
  dispatch,
  movingChordId,
  onMoveChord,
}: ScoreNotationProps) {
  const selectionAnchor = useRef<{ measureId: string; symbolIndex: number } | null>(
    null,
  );
  const chordSelectionAnchor = useRef<ChordPoint | null>(null);

  useEffect(() => {
    if (state.selection?.context !== "melody") {
      selectionAnchor.current = null;
      return;
    }
    const anchor = selectionAnchor.current;
    if (
      anchor?.measureId !== state.selection.measureId ||
      anchor.symbolIndex < state.selection.start ||
      anchor.symbolIndex >= state.selection.end
    ) {
      selectionAnchor.current = {
        measureId: state.selection.measureId,
        symbolIndex: state.selection.start,
      };
    }
  }, [state.selection]);

  useEffect(() => {
    if (state.selection?.context !== "chord") {
      chordSelectionAnchor.current = null;
      return;
    }
    const anchor = chordSelectionAnchor.current;
    if (
      anchor?.measureId !== state.selection.measureId ||
      anchor.position < state.selection.startPosition ||
      anchor.position > state.selection.endPosition
    ) {
      chordSelectionAnchor.current = {
        measureId: state.selection.measureId,
        position: state.selection.startPosition,
      };
    }
  }, [state.selection]);

  function selectSymbol(
    measureId: string,
    symbolIndex: number,
    extend: boolean,
  ) {
    const anchor = selectionAnchor.current;
    if (!extend || anchor === null || anchor.measureId !== measureId) {
      selectionAnchor.current = { measureId, symbolIndex };
      dispatch({
        type: "set-selection",
        selection: {
          context: "melody",
          measureId,
          start: symbolIndex,
          end: symbolIndex + 1,
        },
      });
      return;
    }

    dispatch({
      type: "set-selection",
      selection: {
        context: "melody",
        measureId,
        start: Math.min(anchor.symbolIndex, symbolIndex),
        end: Math.max(anchor.symbolIndex, symbolIndex) + 1,
      },
    });
  }

  function selectChordPosition(
    measureId: string,
    position: number,
    extend: boolean,
  ) {
    const anchor = chordSelectionAnchor.current;
    if (!extend || anchor === null || anchor.measureId !== measureId) {
      chordSelectionAnchor.current = { measureId, position };
      dispatch({
        type: "set-selection",
        selection: {
          context: "chord",
          measureId,
          startPosition: position,
          endPosition: position,
        },
      });
      return;
    }

    dispatch({
      type: "set-selection",
      selection: {
        context: "chord",
        measureId,
        startPosition: Math.min(anchor.position, position),
        endPosition: Math.max(anchor.position, position),
      },
    });
  }

  return (
    <div className="measure-grid">
      {state.score.measures.map((measure, measureIndex) => (
        <MeasureView
          key={measure.id}
          measure={measure}
          measureIndex={measureIndex}
          state={state}
          dispatch={dispatch}
          onSelectSymbol={selectSymbol}
          movingChordId={movingChordId}
          onSelectChordPosition={selectChordPosition}
          onMoveChord={onMoveChord}
        />
      ))}
    </div>
  );
}

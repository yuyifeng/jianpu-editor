import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  Check,
  ClipboardPaste,
  Copy,
  Download,
  FilePlus2,
  FolderOpen,
  MoveRight,
  Pause,
  Play,
  Redo2,
  Save,
  Square,
  Trash2,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";

import {
  createEditorState,
  createEmptyScore,
  editorReducer,
  haveSamePitch,
  parseEditorShortcut,
  shortcutToEditorAction,
  type Accidental,
  type Duration,
  type KeySignature,
  type MelodySymbolChanges,
  type Mode,
  type Octave,
  type ScaleDegree,
  type Score,
  type ScoreDocumentError,
  type ScoreMetadataChanges,
  type TimeSignature,
} from "./domain";
import {
  confirmNewScore,
  confirmScoreImport,
  downloadScoreJson,
  importScoreJson,
  readJsonFile,
  selectJsonFile,
} from "./fileWorkflow";
import {
  browserStorage,
  DebouncedDraftSaver,
  restoreDraft,
  type DraftRestoreResult,
  type SaveStatus,
} from "./persistence";
import { useScorePlayback } from "./playback/useScorePlayback";
import { ScoreNotation } from "./ScoreNotation";

interface Command {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly disabled?: boolean;
  readonly unavailableReason?: string;
  readonly onClick?: () => void;
}

interface InitialEditorSession {
  readonly draft: DraftRestoreResult;
  readonly score: Score;
}

interface WorkflowNotice {
  readonly kind: "error" | "success";
  readonly message: string;
}

const PITCHES: ReadonlyArray<ScaleDegree | 0> = [1, 2, 3, 4, 5, 6, 7, 0];

const DURATION_OPTIONS: ReadonlyArray<{
  readonly value: Duration;
  readonly label: string;
}> = [
  { value: "whole", label: "全音符" },
  { value: "half", label: "二分音符" },
  { value: "quarter", label: "四分音符" },
  { value: "eighth", label: "八分音符" },
  { value: "sixteenth", label: "十六分音符" },
];

const OCTAVE_OPTIONS: ReadonlyArray<{
  readonly value: Octave;
  readonly label: string;
}> = [
  { value: 2, label: "高两个八度" },
  { value: 1, label: "高一个八度" },
  { value: 0, label: "中央八度" },
  { value: -1, label: "低一个八度" },
  { value: -2, label: "低两个八度" },
];

const ACCIDENTAL_OPTIONS: ReadonlyArray<{
  readonly value: Accidental;
  readonly label: string;
}> = [
  { value: "none", label: "无" },
  { value: "sharp", label: "升号" },
  { value: "flat", label: "降号" },
  { value: "natural", label: "还原号" },
];

const SAVE_STATUS_LABELS: Readonly<Record<SaveStatus, string>> = {
  saving: "保存中",
  saved: "已保存",
  failed: "保存失败",
};

function createInitialEditorSession(): InitialEditorSession {
  const draft = restoreDraft(browserStorage);
  return {
    draft,
    score: draft.kind === "restored" ? draft.score : createEmptyScore(),
  };
}

function importErrorMessage(error: ScoreDocumentError): string {
  switch (error.code) {
    case "INVALID_JSON":
      return "导入失败：文件不是合法 JSON，当前乐谱未更改。";
    case "UNSUPPORTED_VERSION":
      return "导入失败：文件版本不受支持，请使用本工具导出的兼容文件。";
    case "INVALID_STRUCTURE":
      return `导入失败：文件结构不完整或无效（${error.message}），当前乐谱未更改。`;
  }
}

function CommandButton({ command }: { readonly command: Command }) {
  const Icon = command.icon;
  const title = command.unavailableReason ?? command.label;

  return (
    <button
      className="command-button"
      type="button"
      title={title}
      aria-label={title}
      disabled={command.disabled}
      onClick={command.onClick}
    >
      <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
      <span>{command.label}</span>
    </button>
  );
}

function isTextControl(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function App() {
  const [initialSession] = useState(createInitialEditorSession);
  const [state, dispatch] = useReducer(
    editorReducer,
    initialSession.score,
    createEditorState,
  );
  const [selectedPitch, setSelectedPitch] = useState<ScaleDegree>(1);
  const [movingChordId, setMovingChordId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(
    initialSession.draft.kind === "invalid" ||
      initialSession.draft.kind === "unavailable"
      ? "failed"
      : "saved",
  );
  const [draftProtection, setDraftProtection] = useState<
    "invalid" | "unavailable" | null
  >(
    initialSession.draft.kind === "invalid" ||
      initialSession.draft.kind === "unavailable"
      ? initialSession.draft.kind
      : null,
  );
  const [workflowNotice, setWorkflowNotice] =
    useState<WorkflowNotice | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const workspaceScrollerRef = useRef<HTMLDivElement>(null);
  const observedScoreRef = useRef(initialSession.score);
  const skipAutosaveScoreRef = useRef<Score | null>(null);
  const lastSavedScoreRef = useRef<Score | null>(
    initialSession.draft.kind === "invalid" ||
      initialSession.draft.kind === "unavailable"
      ? null
      : initialSession.score,
  );
  const saverRef = useRef<DebouncedDraftSaver | null>(null);
  if (saverRef.current === null) {
    saverRef.current = new DebouncedDraftSaver(browserStorage, (event) => {
      setSaveStatus(event.status);
      if (event.status === "saved" && event.score !== undefined) {
        lastSavedScoreRef.current = event.score;
      }
    });
  }
  const saver = saverRef.current;
  const { score, input, selection } = state;
  const playback = useScorePlayback(state, dispatch, workspaceScrollerRef);
  const hasUnsavedChanges =
    saveStatus !== "saved" || lastSavedScoreRef.current !== score;

  useLayoutEffect(() => {
    if (observedScoreRef.current === score) {
      return;
    }
    observedScoreRef.current = score;

    if (skipAutosaveScoreRef.current === score) {
      skipAutosaveScoreRef.current = null;
      return;
    }
    if (draftProtection !== null) {
      return;
    }

    saver.schedule(score);
  }, [draftProtection, saver, score]);

  useEffect(() => () => saver.dispose(), [saver]);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (isTextControl(event.target)) {
        return;
      }
      if (event.key === "Escape" && movingChordId !== null) {
        event.preventDefault();
        setMovingChordId(null);
        return;
      }
      const shortcut = parseEditorShortcut({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        isComposing: event.isComposing,
      });
      if (shortcut === null) {
        return;
      }
      event.preventDefault();
      dispatch(shortcutToEditorAction(shortcut));
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [movingChordId]);

  useEffect(() => {
    if (
      movingChordId !== null &&
      !score.measures.some((measure) =>
        measure.chords.some((chord) => chord.id === movingChordId),
      )
    ) {
      setMovingChordId(null);
    }
  }, [movingChordId, score.measures]);

  const selectedRange =
    selection?.context === "melody" && selection.start < selection.end
      ? selection
      : null;
  const selectedMeasure =
    selectedRange === null
      ? null
      : score.measures.find((measure) => measure.id === selectedRange.measureId) ??
        null;
  const selectedSymbols =
    selectedRange === null || selectedMeasure === null
      ? []
      : selectedMeasure.symbols.slice(selectedRange.start, selectedRange.end);
  const selectedNote =
    selectedSymbols.length === 1 && selectedSymbols[0].kind === "note"
      ? selectedSymbols[0]
      : null;
  const selectedNoteIndex =
    selectedNote === null || selectedRange === null ? -1 : selectedRange.start;
  const nextSymbol =
    selectedMeasure === null || selectedNoteIndex < 0
      ? undefined
      : selectedMeasure.symbols[selectedNoteIndex + 1];
  const canEnableTie =
    selectedNote !== null &&
    nextSymbol?.kind === "note" &&
    haveSamePitch(selectedNote, nextSymbol);
  const selectedChordRange =
    selection?.context === "chord" ? selection : null;
  const selectedChordMeasure =
    selectedChordRange === null
      ? null
      : score.measures.find(
          (measure) => measure.id === selectedChordRange.measureId,
        ) ?? null;
  const selectedChords =
    selectedChordRange === null || selectedChordMeasure === null
      ? []
      : selectedChordMeasure.chords.filter(
          (chord) =>
            chord.position >= selectedChordRange.startPosition &&
            chord.position <= selectedChordRange.endPosition,
        );
  const cursorChord =
    state.cursor.context !== "chord"
      ? null
      : score.measures
          .find((measure) => measure.id === state.cursor.measureId)
          ?.chords.find((chord) => chord.position === state.cursor.position) ??
        null;
  const targetedChords =
    selectedChordRange === null
      ? cursorChord === null
        ? []
        : [cursorChord]
      : selectedChords;
  const selectedChord =
    targetedChords.length === 1 ? targetedChords[0] : null;
  const activeChordDegree = selectedChord?.degree ?? cursorChord?.degree;
  const editingContext = state.cursor.context;

  function replaceScoreAndSave(replacement: Score): boolean {
    setDraftProtection(null);
    skipAutosaveScoreRef.current = replacement;
    observedScoreRef.current = score;
    dispatch({ type: "replace-score", score: replacement });
    return saver.saveNow(replacement);
  }

  function handleNewScore() {
    if (!confirmNewScore(hasUnsavedChanges)) {
      return;
    }

    const saved = replaceScoreAndSave(createEmptyScore());
    setMovingChordId(null);
    setWorkflowNotice(
      saved
        ? { kind: "success", message: "已新建默认乐谱并清除编辑历史。" }
        : {
            kind: "error",
            message:
              "已新建乐谱，但本地保存失败。请检查存储权限或先导出 JSON 备份。",
          },
    );
  }

  async function handleImport() {
    setWorkflowNotice(null);
    let file: File | null;
    try {
      file = await selectJsonFile();
    } catch {
      setWorkflowNotice({
        kind: "error",
        message: "无法打开文件选择器，当前乐谱未更改。",
      });
      return;
    }
    if (file === null) {
      return;
    }

    let json: string;
    try {
      json = await readJsonFile(file);
    } catch {
      setWorkflowNotice({
        kind: "error",
        message: "无法读取所选文件，请检查文件权限后重试。当前乐谱未更改。",
      });
      return;
    }

    const imported = importScoreJson(json);
    if (!imported.ok) {
      setWorkflowNotice({
        kind: "error",
        message: importErrorMessage(imported.error),
      });
      return;
    }
    if (!confirmScoreImport()) {
      return;
    }

    const saved = replaceScoreAndSave(imported.score);
    setMovingChordId(null);
    setWorkflowNotice(
      saved
        ? {
            kind: "success",
            message: `已导入“${file.name}”，清除编辑历史并保存本地草稿。`,
          }
        : {
            kind: "error",
            message:
              "文件已导入，但本地保存失败。请立即导出 JSON，并检查浏览器存储权限或空间。",
          },
    );
  }

  function handleExport() {
    try {
      downloadScoreJson(score);
      setWorkflowNotice({
        kind: "success",
        message: "已导出版本化 UTF-8 JSON 文件。",
      });
    } catch {
      setWorkflowNotice({
        kind: "error",
        message: "导出失败，请检查浏览器下载权限后重试。",
      });
    }
  }

  const fileCommands: Command[] = [
    {
      label: "新建",
      icon: FilePlus2,
      onClick: handleNewScore,
    },
    {
      label: "导入",
      icon: FolderOpen,
      onClick: () => void handleImport(),
    },
    {
      label: "导出",
      icon: Download,
      onClick: handleExport,
    },
  ];
  const editCommands: Command[] = [
    {
      label: "撤销",
      icon: Undo2,
      disabled: state.history.past.length === 0,
      onClick: () => dispatch({ type: "undo" }),
    },
    {
      label: "重做",
      icon: Redo2,
      disabled: state.history.future.length === 0,
      onClick: () => dispatch({ type: "redo" }),
    },
  ];

  function updateMetadata(changes: ScoreMetadataChanges) {
    dispatch({ type: "set-score-metadata", changes });
  }

  function updateInput(changes: MelodySymbolChanges) {
    const inputChanges = {
      ...(changes.duration === undefined ? {} : { duration: changes.duration }),
      ...(changes.octave === undefined ? {} : { octave: changes.octave }),
      ...(changes.accidental === undefined
        ? {}
        : { accidental: changes.accidental }),
      ...(changes.dotted === undefined ? {} : { dotted: changes.dotted }),
    };
    dispatch({ type: "set-input", changes: inputChanges });
    if (selectedRange !== null) {
      dispatch({ type: "update-selected-melody", changes });
    }
  }

  function inputPitch(pitch: ScaleDegree | 0) {
    if (pitch === 0) {
      dispatch({ type: "input-rest" });
      return;
    }
    setSelectedPitch(pitch);
    if (selectedRange !== null) {
      dispatch({
        type: "update-selected-melody",
        changes: { degree: pitch },
      });
      return;
    }
    dispatch({ type: "input-degree", degree: pitch });
  }

  function setEditingContext(context: "melody" | "chord") {
    if (context === editingContext) {
      workspaceRef.current?.focus();
      return;
    }
    const measure =
      score.measures.find((candidate) => candidate.id === state.cursor.measureId) ??
      score.measures[0];
    setMovingChordId(null);
    dispatch({
      type: "set-cursor",
      cursor:
        context === "melody"
          ? {
              context: "melody",
              measureId: measure.id,
              symbolIndex: measure.symbols.length,
            }
          : { context: "chord", measureId: measure.id, position: 0 },
    });
    workspaceRef.current?.focus();
  }

  return (
    <main className="app-shell">
      <header className="command-bar">
        <div className="brand" aria-label="简谱工坊">
          <span className="brand-mark" aria-hidden="true">
            1
          </span>
          <div>
            <strong>简谱工坊</strong>
            <span>Jianpu Editor</span>
          </div>
        </div>

        <div className="command-groups">
          <div className="command-group" aria-label="文件命令">
            {fileCommands.map((command) => (
              <CommandButton command={command} key={command.label} />
            ))}
          </div>
          <div className="command-group" aria-label="编辑命令">
            {editCommands.map((command) => (
              <CommandButton command={command} key={command.label} />
            ))}
          </div>
          <div className="transport" aria-label="播放控制">
            <button
              className="transport-button transport-button-primary"
              type="button"
              title={
                state.playback.status === "paused"
                  ? "继续播放"
                  : playback.loading
                    ? "正在加载钢琴采样"
                    : "从光标播放"
              }
              aria-label={
                state.playback.status === "paused" ? "继续播放" : "播放"
              }
              disabled={
                playback.loading ||
                state.playback.status === "playing" ||
                !playback.canPlay
              }
              onClick={() => void playback.play()}
            >
              <Play aria-hidden="true" size={18} fill="currentColor" />
            </button>
            <button
              className="transport-button"
              type="button"
              title="暂停"
              aria-label="暂停"
              disabled={
                !playback.loading && state.playback.status !== "playing"
              }
              onClick={playback.pause}
            >
              <Pause aria-hidden="true" size={18} />
            </button>
            <button
              className="transport-button"
              type="button"
              title="停止并回到光标"
              aria-label="停止并回到光标"
              disabled={
                !playback.loading && state.playback.status === "stopped"
              }
              onClick={playback.stop}
            >
              <Square aria-hidden="true" size={16} />
            </button>
            <span className="transport-status" role="status" aria-live="polite">
              {playback.error ??
                (playback.loading
                  ? "加载钢琴采样…"
                  : state.playback.status === "playing"
                    ? "播放中"
                    : state.playback.status === "paused"
                      ? "已暂停"
                      : "")}
            </span>
          </div>
        </div>

        <div
          className={`save-status save-status-${saveStatus}`}
          title={
            saveStatus === "failed"
              ? "本地保存失败；请检查浏览器存储权限或空间"
              : SAVE_STATUS_LABELS[saveStatus]
          }
          role="status"
          aria-live="polite"
        >
          {saveStatus === "saved" ? (
            <Check aria-hidden="true" size={15} />
          ) : saveStatus === "failed" ? (
            <AlertTriangle aria-hidden="true" size={15} />
          ) : (
            <Save aria-hidden="true" size={15} />
          )}
          <span>{SAVE_STATUS_LABELS[saveStatus]}</span>
        </div>
      </header>

      <section className="score-info" aria-label="歌曲信息">
        {draftProtection !== null ? (
          <div className="workflow-notice workflow-notice-error" role="alert">
            <AlertTriangle aria-hidden="true" size={16} />
            <span>
              {draftProtection === "invalid"
                ? "本地草稿已损坏或版本不兼容，原始数据已保留且不会自动覆盖。请点击“新建”确认放弃，或点击“导入”选择有效 JSON 恢复。"
                : "无法读取浏览器本地存储，为避免覆盖未知草稿，自动保存已暂停。请检查存储权限，或通过“新建”/“导入”确认后重试。"}
            </span>
          </div>
        ) : null}
        {saveStatus === "failed" &&
        draftProtection === null &&
        workflowNotice?.kind !== "error" ? (
          <div className="workflow-notice workflow-notice-error" role="alert">
            <AlertTriangle aria-hidden="true" size={16} />
            <span>
              本地保存失败。请检查浏览器存储权限或空间，并先导出 JSON
              备份当前乐谱。
            </span>
          </div>
        ) : null}
        {workflowNotice !== null ? (
          <div
            className={`workflow-notice workflow-notice-${workflowNotice.kind}`}
            role={workflowNotice.kind === "error" ? "alert" : "status"}
          >
            {workflowNotice.kind === "error" ? (
              <AlertTriangle aria-hidden="true" size={16} />
            ) : (
              <Check aria-hidden="true" size={16} />
            )}
            <span>{workflowNotice.message}</span>
            <button
              type="button"
              aria-label="关闭提示"
              title="关闭提示"
              onClick={() => setWorkflowNotice(null)}
            >
              <X aria-hidden="true" size={14} />
            </button>
          </div>
        ) : null}
        <label className="field field-title">
          <span>标题</span>
          <input
            value={score.title}
            type="text"
            onChange={(event) =>
              updateMetadata({ title: event.currentTarget.value })
            }
          />
        </label>
        <label className="field">
          <span>调号</span>
          <select
            value={score.keySignature}
            onChange={(event) =>
              updateMetadata({
                keySignature: event.currentTarget.value as KeySignature,
              })
            }
          >
            <option value="C">1 = C</option>
            <option value="C#/Db">1 = ♯C / ♭D</option>
            <option value="D">1 = D</option>
            <option value="D#/Eb">1 = ♯D / ♭E</option>
            <option value="E">1 = E</option>
            <option value="F">1 = F</option>
            <option value="F#/Gb">1 = ♯F / ♭G</option>
            <option value="G">1 = G</option>
            <option value="G#/Ab">1 = ♯G / ♭A</option>
            <option value="A">1 = A</option>
            <option value="A#/Bb">1 = ♯A / ♭B</option>
            <option value="B">1 = B</option>
          </select>
        </label>
        <label className="field">
          <span>调式</span>
          <select
            value={score.mode}
            onChange={(event) =>
              updateMetadata({ mode: event.currentTarget.value as Mode })
            }
          >
            <option value="major">大调</option>
            <option value="natural-minor">自然小调</option>
          </select>
        </label>
        <label className="field">
          <span>拍号</span>
          <select
            value={score.timeSignature}
            onChange={(event) =>
              updateMetadata({
                timeSignature: event.currentTarget.value as TimeSignature,
              })
            }
          >
            <option value="2/4">2/4</option>
            <option value="3/4">3/4</option>
            <option value="4/4">4/4</option>
            <option value="6/8">6/8</option>
          </select>
        </label>
        <label className="field field-tempo">
          <span>速度</span>
          <span className="input-suffix">
            <input
              value={score.tempo}
              max="240"
              min="30"
              type="number"
              onChange={(event) => {
                const tempo = Number(event.currentTarget.value);
                if (Number.isInteger(tempo) && tempo >= 30 && tempo <= 240) {
                  updateMetadata({ tempo });
                }
              }}
            />
            <span>BPM</span>
          </span>
        </label>
      </section>

      <section className="note-toolbar" aria-label="谱面编辑工具栏">
        <div
          className="context-switch"
          role="radiogroup"
          aria-label="编辑模式"
        >
          <button
            className={editingContext === "melody" ? "is-active" : ""}
            type="button"
            role="radio"
            aria-checked={editingContext === "melody"}
            onClick={() => setEditingContext("melody")}
          >
            旋律
          </button>
          <button
            className={editingContext === "chord" ? "is-active" : ""}
            type="button"
            role="radio"
            aria-checked={editingContext === "chord"}
            onClick={() => setEditingContext("chord")}
          >
            和弦
          </button>
        </div>

        <div className="tool-divider" aria-hidden="true" />

        <div className="tool-group">
          <span className="tool-label">
            {editingContext === "melody" ? "输入音符" : "输入和弦级数"}
          </span>
          <div
            className="pitch-picker"
            role="group"
            aria-label={
              editingContext === "melody" ? "选择音级" : "选择和弦级数"
            }
          >
            {PITCHES.filter(
              (pitch) => editingContext === "melody" || pitch !== 0,
            ).map((pitch) => {
              const active =
                pitch !== 0 && editingContext === "chord"
                  ? activeChordDegree === pitch
                  : pitch !== 0 &&
                    (selectedNote?.degree ?? selectedPitch) === pitch;
              return (
                <button
                  className={`pitch-button ${active ? "is-active" : ""}`}
                  type="button"
                  aria-label={
                    pitch === 0
                      ? "插入休止符"
                      : editingContext === "chord"
                        ? `输入和弦级数 ${pitch}`
                        : `输入音级 ${pitch}`
                  }
                  aria-pressed={active}
                  key={pitch}
                  onClick={() => inputPitch(pitch)}
                >
                  {pitch}
                </button>
              );
            })}
          </div>
        </div>

        {editingContext === "melody" ? (
          <>
            <div className="tool-divider" aria-hidden="true" />
            <label className="compact-field">
              <span>时值</span>
              <select
                value={selectedSymbols[0]?.duration ?? input.duration}
                onChange={(event) =>
                  updateInput({ duration: event.currentTarget.value as Duration })
                }
              >
                {DURATION_OPTIONS.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="compact-field">
              <span>八度</span>
              <select
                value={selectedNote?.octave ?? input.octave}
                onChange={(event) =>
                  updateInput({
                    octave: Number(event.currentTarget.value) as Octave,
                  })
                }
              >
                {OCTAVE_OPTIONS.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="compact-field">
              <span>临时记号</span>
              <select
                value={selectedNote?.accidental ?? input.accidental}
                onChange={(event) =>
                  updateInput({
                    accidental: event.currentTarget.value as Accidental,
                  })
                }
              >
                {ACCIDENTAL_OPTIONS.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              className={`toggle-tool ${
                (selectedSymbols[0]?.dotted ?? input.dotted) ? "is-active" : ""
              }`}
              type="button"
              aria-pressed={selectedSymbols[0]?.dotted ?? input.dotted}
              onClick={() =>
                updateInput({
                  dotted: !(selectedSymbols[0]?.dotted ?? input.dotted),
                })
              }
            >
              附点
            </button>
            <button
              className={`toggle-tool ${
                selectedNote?.tieToNext ? "is-active" : ""
              }`}
              type="button"
              disabled={
                selectedNote === null ||
                (!selectedNote.tieToNext && !canEnableTie)
              }
              title={
                selectedNote === null
                  ? "先单选一个音符"
                  : canEnableTie || selectedNote.tieToNext
                    ? "切换与下一个同音音符的连音线"
                    : "连音线要求后方紧邻同音音符"
              }
              aria-pressed={selectedNote?.tieToNext ?? false}
              onClick={() =>
                dispatch({
                  type: "update-selected-melody",
                  changes: { tieToNext: !selectedNote?.tieToNext },
                })
              }
            >
              连音
            </button>
          </>
        ) : (
          <>
            <div className="tool-divider" aria-hidden="true" />
            <div className="chord-command-group" aria-label="和弦编辑命令">
              <button
                type="button"
                disabled={targetedChords.length === 0}
                title="复制选中的和弦"
                onClick={() => dispatch({ type: "copy" })}
              >
                <Copy aria-hidden="true" size={15} />
                复制
              </button>
              <button
                type="button"
                disabled={state.clipboard?.context !== "chord"}
                title="从当前拍位粘贴和弦"
                onClick={() => dispatch({ type: "paste" })}
              >
                <ClipboardPaste aria-hidden="true" size={15} />
                粘贴
              </button>
              <button
                type="button"
                disabled={targetedChords.length === 0}
                title="删除选中的和弦"
                onClick={() => dispatch({ type: "delete-forward" })}
              >
                <Trash2 aria-hidden="true" size={15} />
                删除
              </button>
              <button
                className={movingChordId !== null ? "is-active" : ""}
                type="button"
                disabled={selectedChord === null && movingChordId === null}
                aria-pressed={movingChordId !== null}
                title={
                  movingChordId === null
                    ? "选择移动源，再点击目标拍位"
                    : "取消移动"
                }
                onClick={() =>
                  setMovingChordId(
                    movingChordId === null ? selectedChord?.id ?? null : null,
                  )
                }
              >
                {movingChordId === null ? (
                  <MoveRight aria-hidden="true" size={15} />
                ) : (
                  <X aria-hidden="true" size={15} />
                )}
                {movingChordId === null ? "移动" : "取消"}
              </button>
            </div>
            <span className="chord-mode-help" role="status" aria-live="polite">
              {movingChordId === null
                ? "点击拍位后用 1-7 输入；Shift 点击可连续选择"
                : "移动中：点击任意小节的目标拍位，Esc 取消"}
            </span>
          </>
        )}
      </section>

      <section
        className="workspace"
        aria-label="谱面编辑区"
        ref={workspaceRef}
        tabIndex={0}
      >
        <div className="workspace-scroller" ref={workspaceScrollerRef}>
          <article className="score-page">
            <header className="score-heading">
              <h1>{score.title || "未命名歌曲"}</h1>
              <div className="score-meta">
                <span>1 = {score.keySignature}</span>
                <span>{score.mode === "major" ? "大调" : "自然小调"}</span>
                <span>{score.timeSignature}</span>
                <span>♩ = {score.tempo}</span>
              </div>
            </header>

            <ScoreNotation
              state={state}
              dispatch={dispatch}
              movingChordId={movingChordId}
              onMoveChord={(target) => {
                if (movingChordId === null) {
                  return;
                }
                dispatch({
                  type: "move-chord",
                  chordId: movingChordId,
                  target,
                });
                setMovingChordId(null);
              }}
            />
          </article>
        </div>

        <footer className="workspace-status" role="status">
          <span>
            第{" "}
            {score.measures.findIndex(
              (measure) => measure.id === state.cursor.measureId,
            ) + 1}{" "}
            小节
          </span>
          <span>
            {editingContext === "chord"
              ? targetedChords.length > 0
                ? `已选 ${targetedChords.length} 个和弦`
                : "和弦编辑"
              : selectedSymbols.length > 0
                ? `已选 ${selectedSymbols.length} 个符号`
                : "旋律编辑"}
          </span>
          <span className="shortcut-hint">
            {editingContext === "chord"
              ? "数字键 1-7 录入和弦 · Shift 点击连续选择"
              : "数字键 1-7 / 0 录入旋律 · Shift 点击连续选择"}
          </span>
        </footer>
      </section>
    </main>
  );
}

export default App;

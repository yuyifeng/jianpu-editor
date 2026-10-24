import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
} from "react";

import { PianoAudioEngine } from "../audio/PianoAudioEngine";
import {
  type EditorAction,
  type EditorState,
  type PlaybackState,
  type Score,
} from "../domain";
import {
  buildPlaybackTimeline,
  getCursorStartUnits,
  getPlaybackFrame,
  getPlaybackStartSeconds,
  hasPlaybackContent,
  unitsToSeconds,
  type PlaybackFrame,
  type PlaybackTimeline,
} from "./timeline";

interface ScorePlaybackControls {
  readonly loading: boolean;
  readonly error: string | null;
  readonly canPlay: boolean;
  readonly play: () => Promise<void>;
  readonly pause: () => void;
  readonly stop: () => void;
}

interface RunState {
  readonly timeline: PlaybackTimeline;
  readonly startPosition: number;
  readonly contextStartTime: number;
}

const SCHEDULE_LEAD_SECONDS = 0.04;

function sameFrame(left: PlaybackFrame, right: PlaybackFrame): boolean {
  return (
    left.symbolId === right.symbolId && left.chordId === right.chordId
  );
}

function toPlaybackState(
  status: PlaybackState["status"],
  frame: PlaybackFrame = {},
): PlaybackState {
  return { status, ...frame };
}

function findPlaybackElement(
  scroller: HTMLElement,
  frame: PlaybackFrame,
): HTMLElement | null {
  if (frame.symbolId !== undefined) {
    const symbol = [...scroller.querySelectorAll<HTMLElement>("[data-symbol-id]")].find(
      (element) => element.dataset.symbolId === frame.symbolId,
    );
    if (symbol !== undefined) {
      return symbol;
    }
  }
  if (frame.chordId !== undefined) {
    return (
      [...scroller.querySelectorAll<HTMLElement>("[data-chord-id]")].find(
        (element) => element.dataset.chordId === frame.chordId,
      ) ?? null
    );
  }
  return null;
}

function scheduleTimeline(
  engine: PianoAudioEngine,
  timeline: PlaybackTimeline,
  startPosition: number,
  contextStartTime: number,
): void {
  for (const event of timeline.melodyVoices) {
    const eventStart = unitsToSeconds(timeline, event.startUnits);
    const eventEnd = unitsToSeconds(timeline, event.endUnits);
    if (eventEnd <= startPosition) {
      continue;
    }
    const scheduledPosition = Math.max(eventStart, startPosition);
    engine.scheduleVoice(
      event.id,
      "melody",
      event.midi,
      contextStartTime + scheduledPosition - startPosition,
      eventEnd - scheduledPosition,
    );
  }

  for (const event of timeline.chords) {
    const eventStart = unitsToSeconds(timeline, event.startUnits);
    const eventEnd = unitsToSeconds(timeline, event.endUnits);
    if (eventEnd <= startPosition) {
      continue;
    }
    const scheduledPosition = Math.max(eventStart, startPosition);
    event.midi.forEach((midi, noteIndex) => {
      engine.scheduleVoice(
        `chord:${event.chordId}:${noteIndex}`,
        "chord",
        midi,
        contextStartTime + scheduledPosition - startPosition,
        eventEnd - scheduledPosition,
      );
    });
  }
}

export function useScorePlayback(
  state: EditorState,
  dispatch: Dispatch<EditorAction>,
  scrollerRef: RefObject<HTMLElement | null>,
): ScorePlaybackControls {
  const engineRef = useRef<PianoAudioEngine | null>(null);
  if (engineRef.current === null) {
    engineRef.current = new PianoAudioEngine();
  }
  const engine = engineRef.current;
  const stateRef = useRef(state);
  stateRef.current = state;
  const scoreRef = useRef<Score>(state.score);
  const runRef = useRef<RunState | null>(null);
  const pausedPositionRef = useRef(0);
  const frameRef = useRef<PlaybackFrame>({});
  const animationFrameRef = useRef<number | null>(null);
  const followPlaybackRef = useRef<() => void>(() => undefined);
  const operationRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeline = useMemo(
    () => buildPlaybackTimeline(state.score),
    [state.score],
  );
  const canPlay = hasPlaybackContent(timeline);

  const cancelAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const showFrame = useCallback(
    (status: PlaybackState["status"], frame: PlaybackFrame) => {
      if (sameFrame(frameRef.current, frame) &&
          stateRef.current.playback.status === status) {
        return;
      }
      frameRef.current = frame;
      dispatch({ type: "set-playback", playback: toPlaybackState(status, frame) });

      if (status !== "playing") {
        return;
      }
      const scroller = scrollerRef.current;
      if (scroller === null) {
        return;
      }
      findPlaybackElement(scroller, frame)?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    },
    [dispatch, scrollerRef],
  );

  const stop = useCallback(() => {
    operationRef.current += 1;
    setLoading(false);
    cancelAnimation();
    engine.stopAll();
    runRef.current = null;
    const current = stateRef.current;
    const currentTimeline = buildPlaybackTimeline(current.score);
    const cursorUnits = getCursorStartUnits(current.score, current.cursor);
    pausedPositionRef.current =
      cursorUnits >= currentTimeline.durationUnits
        ? 0
        : unitsToSeconds(currentTimeline, cursorUnits);
    frameRef.current = {};
    dispatch({
      type: "set-playback",
      playback: { status: "stopped" },
    });
  }, [cancelAnimation, dispatch, engine]);

  const pause = useCallback(() => {
    operationRef.current += 1;
    setLoading(false);
    cancelAnimation();
    const run = runRef.current;
    if (run === null) {
      engine.stopAll();
      return;
    }

    const elapsed = Math.max(0, engine.currentTime - run.contextStartTime);
    const position = Math.min(
      run.timeline.durationSeconds,
      run.startPosition + elapsed,
    );
    pausedPositionRef.current = position;
    runRef.current = null;
    engine.stopAll();
    const frame = getPlaybackFrame(run.timeline, position);
    frameRef.current = frame;
    dispatch({
      type: "set-playback",
      playback: toPlaybackState("paused", frame),
    });
  }, [cancelAnimation, dispatch, engine]);

  const followPlayback = useCallback(() => {
    const run = runRef.current;
    if (run === null) {
      animationFrameRef.current = null;
      return;
    }

    const elapsed = Math.max(0, engine.currentTime - run.contextStartTime);
    const position = run.startPosition + elapsed;
    if (position >= run.timeline.durationSeconds) {
      stop();
      return;
    }

    showFrame("playing", getPlaybackFrame(run.timeline, position));
    animationFrameRef.current = window.requestAnimationFrame(
      followPlaybackRef.current,
    );
  }, [engine, showFrame, stop]);
  followPlaybackRef.current = followPlayback;

  const play = useCallback(async () => {
    if (stateRef.current.playback.status === "playing" || loading) {
      return;
    }

    const current = stateRef.current;
    const currentTimeline = buildPlaybackTimeline(current.score);
    if (!hasPlaybackContent(currentTimeline)) {
      return;
    }
    const startPosition =
      current.playback.status === "paused"
        ? pausedPositionRef.current
        : getPlaybackStartSeconds(currentTimeline, current.score, current.cursor);
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    setLoading(true);
    setError(null);

    try {
      await engine.initialize();
      if (operationRef.current !== operation) {
        return;
      }

      cancelAnimation();
      engine.stopAll();
      const contextStartTime = engine.currentTime + SCHEDULE_LEAD_SECONDS;
      scheduleTimeline(
        engine,
        currentTimeline,
        startPosition,
        contextStartTime,
      );
      runRef.current = {
        timeline: currentTimeline,
        startPosition,
        contextStartTime,
      };
      pausedPositionRef.current = startPosition;
      showFrame(
        "playing",
        getPlaybackFrame(currentTimeline, startPosition),
      );
      animationFrameRef.current =
        window.requestAnimationFrame(followPlayback);
    } catch (cause) {
      if (operationRef.current === operation) {
        engine.stopAll();
        runRef.current = null;
        frameRef.current = {};
        dispatch({
          type: "set-playback",
          playback: { status: "stopped" },
        });
        setError(
          cause instanceof Error ? cause.message : "钢琴采样加载失败，请重试",
        );
      }
    } finally {
      if (operationRef.current === operation) {
        setLoading(false);
      }
    }
  }, [
    cancelAnimation,
    dispatch,
    engine,
    followPlayback,
    loading,
    showFrame,
  ]);

  useEffect(() => {
    if (scoreRef.current === state.score) {
      return;
    }
    scoreRef.current = state.score;
    stop();
  }, [state.score, stop]);

  useEffect(() => {
    function releaseForInterruption() {
      if (
        loading ||
        stateRef.current.playback.status === "playing"
      ) {
        pause();
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        releaseForInterruption();
      }
    }

    window.addEventListener("blur", releaseForInterruption);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", releaseForInterruption);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loading, pause]);

  useEffect(
    () => () => {
      operationRef.current += 1;
      cancelAnimation();
      void engine.dispose();
    },
    [cancelAnimation, engine],
  );

  return { loading, error, canPlay, play, pause, stop };
}

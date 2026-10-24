import {
  getPianoSampleMapping,
  PIANO_SAMPLE_ANCHORS,
} from "./pianoSamples";

export type AudioTrack = "melody" | "chord";

interface ScheduledVoice {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
}

type AudioContextConstructor = new () => AudioContext;

const MELODY_GAIN = 0.82;
const CHORD_GAIN = 0.38;
const MASTER_GAIN = 0.9;
const ATTACK_SECONDS = 0.008;
const RELEASE_SECONDS = 0.08;

function getAudioContextConstructor(): AudioContextConstructor {
  const AudioContextClass =
    window.AudioContext ??
    (
      window as typeof window & {
        webkitAudioContext?: AudioContextConstructor;
      }
    ).webkitAudioContext;

  if (AudioContextClass === undefined) {
    throw new Error("当前浏览器不支持 Web Audio");
  }
  return AudioContextClass;
}

export class PianoAudioEngine {
  private context: AudioContext | null = null;
  private melodyBus: GainNode | null = null;
  private chordBus: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private voices = new Map<string, ScheduledVoice>();
  private loadPromise: Promise<void> | null = null;

  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  async initialize(): Promise<void> {
    if (this.context === null) {
      this.createGraph();
    }

    const context = this.context;
    if (context === null) {
      throw new Error("音频引擎初始化失败");
    }
    if (context.state === "suspended") {
      await context.resume();
    }
    if (this.buffers.size === PIANO_SAMPLE_ANCHORS.length) {
      return;
    }
    if (this.loadPromise !== null) {
      return this.loadPromise;
    }

    this.loadPromise = this.loadSamples(context).catch((error: unknown) => {
      this.buffers.clear();
      this.loadPromise = null;
      throw error;
    });
    return this.loadPromise;
  }

  scheduleVoice(
    voiceId: string,
    track: AudioTrack,
    midi: number,
    startTime: number,
    durationSeconds: number,
  ): boolean {
    const context = this.context;
    const bus = track === "melody" ? this.melodyBus : this.chordBus;
    const mapping = getPianoSampleMapping(midi);
    const buffer = this.buffers.get(mapping.anchor.fileName);
    if (
      context === null ||
      bus === null ||
      buffer === undefined ||
      durationSeconds <= 0
    ) {
      return false;
    }

    this.stopVoice(voiceId);
    const source = context.createBufferSource();
    const gain = context.createGain();
    const audibleStart = Math.max(startTime, context.currentTime);
    const endTime = audibleStart + durationSeconds;
    const attackEnd = Math.min(endTime, audibleStart + ATTACK_SECONDS);
    const releaseStart = Math.max(attackEnd, endTime - RELEASE_SECONDS);

    source.buffer = buffer;
    source.playbackRate.value = mapping.playbackRate;
    gain.gain.setValueAtTime(0.0001, audibleStart);
    gain.gain.exponentialRampToValueAtTime(1, attackEnd);
    gain.gain.setValueAtTime(1, releaseStart);
    gain.gain.exponentialRampToValueAtTime(0.0001, endTime);
    source.connect(gain);
    gain.connect(bus);

    const voice: ScheduledVoice = { source, gain };
    this.voices.set(voiceId, voice);
    source.onended = () => {
      if (this.voices.get(voiceId) === voice) {
        this.voices.delete(voiceId);
      }
      source.disconnect();
      gain.disconnect();
    };
    source.start(audibleStart);
    source.stop(endTime + 0.03);
    return true;
  }

  stopAll(): void {
    for (const voiceId of [...this.voices.keys()]) {
      this.stopVoice(voiceId);
    }
  }

  async dispose(): Promise<void> {
    this.stopAll();
    const context = this.context;
    this.context = null;
    this.melodyBus = null;
    this.chordBus = null;
    this.buffers.clear();
    this.loadPromise = null;
    if (context !== null && context.state !== "closed") {
      await context.close();
    }
  }

  private createGraph(): void {
    const AudioContextClass = getAudioContextConstructor();
    const context = new AudioContextClass();
    const melodyBus = context.createGain();
    const chordBus = context.createGain();
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();

    melodyBus.gain.value = MELODY_GAIN;
    chordBus.gain.value = CHORD_GAIN;
    master.gain.value = MASTER_GAIN;
    compressor.threshold.value = -6;
    compressor.knee.value = 4;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;

    melodyBus.connect(master);
    chordBus.connect(master);
    master.connect(compressor);
    compressor.connect(context.destination);

    this.context = context;
    this.melodyBus = melodyBus;
    this.chordBus = chordBus;
  }

  private stopVoice(voiceId: string): void {
    const voice = this.voices.get(voiceId);
    const context = this.context;
    if (voice === undefined || context === null) {
      return;
    }

    this.voices.delete(voiceId);
    const now = context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(
      Math.max(voice.gain.gain.value, 0.0001),
      now,
    );
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    try {
      voice.source.stop(now + 0.05);
    } catch {
      voice.source.disconnect();
      voice.gain.disconnect();
    }
  }

  private async loadSamples(context: AudioContext): Promise<void> {
    const loaded = await Promise.all(
      PIANO_SAMPLE_ANCHORS.map(async (anchor) => {
        const response = await fetch(
          `${import.meta.env.BASE_URL}audio/piano/${anchor.fileName}`,
        );
        if (!response.ok) {
          throw new Error(`无法加载钢琴采样：${anchor.name}`);
        }
        const audioData = await response.arrayBuffer();
        const buffer = await context.decodeAudioData(audioData);
        return [anchor.fileName, buffer] as const;
      }),
    );

    if (this.context !== context) {
      return;
    }
    for (const [fileName, buffer] of loaded) {
      this.buffers.set(fileName, buffer);
    }
  }
}

import type { AudioMode } from "@/lib/brainprint/engine";

export type Tone = {
  carrier: number;
  beat: number;
  mode: AudioMode;
  volume: number;
  /** 1 is full research level. A safety pause ducks this toward 0. */
  duck?: number;
};

/**
 * Headphones matter for binaural beats: each ear gets its own carrier.
 * Isochronic pulses a single tone. Monaural mixes both carriers in both ears.
 * Gain is capped. This is a research tone, not a therapy device.
 */
export class EntrainmentAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private amp: GainNode | null = null;
  private oscA: OscillatorNode | null = null;
  private oscB: OscillatorNode | null = null;
  private gainA: GainNode | null = null;
  private gainB: GainNode | null = null;
  private panA: StereoPannerNode | null = null;
  private panB: StereoPannerNode | null = null;
  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;
  private mode: AudioMode = "binaural";
  private volume = 0.35;
  private duck = 1;

  get running(): boolean {
    return this.ctx !== null;
  }

  async start(tone: Tone): Promise<void> {
    this.stop();
    const Ctx = window.AudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;
    if (ctx.state === "suspended") await ctx.resume();

    const master = ctx.createGain();
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(this.level(tone.volume) * this.duckOf(tone.duck), ctx.currentTime + 0.8);
    master.connect(ctx.destination);
    this.master = master;

    const amp = ctx.createGain();
    amp.connect(master);
    this.amp = amp;

    const oscA = ctx.createOscillator();
    oscA.type = "sine";
    oscA.frequency.value = tone.carrier;
    const gainA = ctx.createGain();
    const panA = ctx.createStereoPanner();
    oscA.connect(gainA);
    gainA.connect(panA);
    panA.connect(amp);

    const oscB = ctx.createOscillator();
    oscB.type = "sine";
    oscB.frequency.value = tone.carrier + tone.beat;
    const gainB = ctx.createGain();
    const panB = ctx.createStereoPanner();
    oscB.connect(gainB);
    gainB.connect(panB);
    panB.connect(amp);

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = Math.max(0.4, tone.beat);
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0;
    lfo.connect(lfoGain);
    lfoGain.connect(amp.gain);

    this.oscA = oscA;
    this.oscB = oscB;
    this.gainA = gainA;
    this.gainB = gainB;
    this.panA = panA;
    this.panB = panB;
    this.lfo = lfo;
    this.lfoGain = lfoGain;
    this.volume = tone.volume;
    this.duck = this.duckOf(tone.duck);
    this.route(tone.mode);
    oscA.start();
    oscB.start();
    lfo.start();
  }

  update(tone: Tone): void {
    if (!this.ctx || !this.oscA || !this.oscB || !this.lfo || !this.master) return;
    const now = this.ctx.currentTime;
    this.volume = tone.volume;
    if (tone.duck !== undefined) this.duck = this.duckOf(tone.duck);
    this.oscA.frequency.setTargetAtTime(tone.carrier, now, 0.05);
    this.oscB.frequency.setTargetAtTime(tone.carrier + Math.max(0.4, tone.beat), now, 0.05);
    this.lfo.frequency.setTargetAtTime(Math.max(0.4, tone.beat), now, 0.05);
    this.master.gain.setTargetAtTime(this.level(this.volume) * this.duck, now, 0.08);
    if (tone.mode !== this.mode) this.route(tone.mode);
  }

  stop(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      this.oscA?.stop();
      this.oscB?.stop();
      this.lfo?.stop();
    } catch {
      /* already stopped */
    }
    void ctx.close();
    this.ctx = null;
    this.master = null;
    this.amp = null;
    this.oscA = null;
    this.oscB = null;
    this.gainA = null;
    this.gainB = null;
    this.panA = null;
    this.panB = null;
    this.lfo = null;
    this.lfoGain = null;
    this.duck = 1;
  }

  private duckOf(duck: number | undefined): number {
    if (duck === undefined) return this.duck;
    return Math.max(0, Math.min(1, duck));
  }

  private level(volume: number): number {
    return Math.max(0, Math.min(1, volume)) * 0.12;
  }

  private route(mode: AudioMode): void {
    if (!this.ctx || !this.amp || !this.gainA || !this.gainB || !this.panA || !this.panB || !this.lfoGain) return;
    const now = this.ctx.currentTime;
    this.mode = mode;
    if (mode === "binaural") {
      this.panA.pan.setValueAtTime(-1, now);
      this.panB.pan.setValueAtTime(1, now);
      this.gainA.gain.setValueAtTime(0.85, now);
      this.gainB.gain.setValueAtTime(0.85, now);
      this.amp.gain.setValueAtTime(1, now);
      this.lfoGain.gain.setValueAtTime(0, now);
      return;
    }
    if (mode === "monaural") {
      this.panA.pan.setValueAtTime(0, now);
      this.panB.pan.setValueAtTime(0, now);
      this.gainA.gain.setValueAtTime(0.5, now);
      this.gainB.gain.setValueAtTime(0.5, now);
      this.amp.gain.setValueAtTime(1, now);
      this.lfoGain.gain.setValueAtTime(0, now);
      return;
    }
    this.panA.pan.setValueAtTime(0, now);
    this.panB.pan.setValueAtTime(0, now);
    this.gainA.gain.setValueAtTime(1, now);
    this.gainB.gain.setValueAtTime(0, now);
    this.amp.gain.setValueAtTime(0.62, now);
    this.lfoGain.gain.setValueAtTime(0.38, now);
  }
}

/**
 * Real-time EEG sync.
 *
 * The model stream is a 256 Hz montage shaped like the selected protocol.
 * A Muse headset replaces it: classic p50 (EEG, accelerometer, gyroscope,
 * optical pulse, battery) or Muse S Athena p1035 (4 EEG, 730/850 nm optics,
 * motion, battery). The signal bench runs those same decoders without a radio.
 *
 * Sync is a phase-locked loop: the audible beat trims until its phase
 * matches the measured frontal rhythm. Research instrument. Not a clinical
 * EEG and not a medical device.
 */

import { BANDS, ELECTRODES, fnv, protocolById, siteBandPower, type BandId } from "./engine.ts";
import { BAND_HZ } from "./resonance.ts";
import { EEG_RATE, EEG_WINDOW, SampleRing, goertzel, wrapPhase } from "./eeg-signal.ts";
import { MuseLink, type MuseFamily } from "./muse-link.ts";
import {
  ACC_SCALE,
  ATHENA_DEFAULT_PRESET,
  ATHENA_EEG_4,
  ATHENA_OPTIC_NAMES,
  ATHENA_OPTIC_ORDER,
  CLASSIC_EEG,
  GYRO_SCALE,
  contactFit,
  decodeAthenaNotification,
  decodeClassicImu,
  decodeClassicPpg,
  decodeMuseEeg,
  decodeTelemetry,
  encodeAthenaNotification,
  encodeClassicEeg,
  encodeClassicImu,
  encodeClassicPpg,
  encodeTelemetry,
  heartRate,
  projectSitePowers,
  type Contact,
  type XYZ,
} from "./muse-protocol.ts";

export type EegSource = "model" | "muse" | "bench";

export type EegDrive = {
  subject: string;
  protocolId: string;
  elapsed: number;
  beat: number;
  running: boolean;
  /** Phase-lock the tone to the measured rhythm. */
  sync: boolean;
  /** Safety pause: drop the trim and stop pulling the model. */
  paused: boolean;
};

export type EegChannel = { id: string; fit: Contact; live: boolean };

export type EegSnapshot = {
  source: EegSource;
  deviceName: string | null;
  sampleRate: number;
  quality: number;
  phaseErrorDeg: number | null;
  locked: boolean;
  seeking: boolean;
  trimHz: number;
  targetHz: number;
  peakHz: number;
  /** Null until the first full window has been measured. */
  liveLock: number | null;
  bandUv: Record<BandId, number>;
  sites: Record<string, Record<BandId, number>> | null;
  spark: number[];
  detail: string;
  bluetooth: boolean;
  family: MuseFamily | "none";
  preset: string | null;
  firmware: string | null;
  hardware: string | null;
  battery: number | null;
  temperatureC: number | null;
  cellV: number | null;
  heartBpm: number | null;
  moving: boolean;
  channels: EegChannel[];
  optics: { id: string; level: number }[];
};

const TRACE_ORDER = ["TP9", "AF7", "AF8", "TP10", "AUX", "AUX1", "AUX2", "AUX3", "AUX4"];
const PPG_RANK = ["IR", "LI_850", "RI_850", "LO_850", "RO_850", "LI_IR", "RI_IR", "RED", "LO_IR", "RO_IR", "LI_730", "RI_730", "LI_NIR", "RI_NIR", "AMBIENT"];
const HORSESHOE_ORDER = ["TP9", "AF7", "AF8", "TP10"];

const RING = 512;
const ANALYZE_MS = 100;
const TRIM_LIMIT = 1.4;

type Osc = { band: BandId; phase: number; amp: number; freq: number };

function nearestBand(hz: number): BandId {
  let best: BandId = "alpha";
  let distance = Infinity;
  for (const band of BANDS) {
    const delta = Math.abs(BAND_HZ[band] - hz);
    if (delta < distance) {
      distance = delta;
      best = band;
    }
  }
  return best;
}

function emptyBands(): Record<BandId, number> {
  return { delta: 0.02, theta: 0.02, alpha: 0.02, smr: 0.02, beta: 0.02, gamma: 0.02 };
}

export class LiveEeg {
  private drive: EegDrive = {
    subject: "did:monarch:session",
    protocolId: "baseline",
    elapsed: 0,
    beat: 10,
    running: false,
    sync: false,
    paused: false,
  };
  private readonly rings = new Map<string, SampleRing>();
  private readonly mix = new SampleRing(RING);
  private readonly window = new Float32Array(EEG_WINDOW);
  private readonly osc = new Map<string, Osc[]>();
  private readonly pink = new Map<string, number>();
  private readonly smoothed = new Map<string, Record<BandId, number>>();
  private sampleTime = 0;
  private nextBlink = 4;
  private blinkUntil = 0;
  private trim = 0;
  private integ = 0;
  private lockStreak = 0;
  private lastAnalyze = 0;
  private lastModelNow = 0;
  private residual = 0;
  /** Stimulus phase on the sample clock, radians. */
  private samplePhase = 0;
  private raf = 0;
  private started = false;
  private analyzed = false;
  private source: EegSource = "model";
  private deviceName: string | null = null;
  private family: MuseFamily | "none" = "none";
  private preset: string | null = null;
  private firmware: string | null = null;
  private hardware: string | null = null;
  private battery: number | null = null;
  private temperatureC: number | null = null;
  private cellV: number | null = null;
  private heartBpm: number | null = null;
  private moving = false;
  private optics: { id: string; level: number }[] = [];
  private readonly native = new Map<string, SampleRing>();
  private readonly fits = new Map<string, Contact>();
  private deviceHorseshoe: Contact[] | null = null;
  private readonly ppgRing = new SampleRing(512);
  private readonly ppgWindow = new Float32Array(512);
  private ppgPick: string | null = null;
  private readonly accels: number[] = [];
  private gyroPeak = 0;
  private motionDropUntil = 0;
  private gaps = 0;
  private benchEegCount = 0;
  private ppgAcc = 0;
  private imuAcc = 0;
  private benchPpg: number[] = [];
  private benchAcc: XYZ[] = [];
  private benchGyro: XYZ[] = [];
  private benchHold = new Map<string, number[]>();
  private opticHold = new Map<string, number[]>();
  private opticBase = new Map<string, number>();
  private channelIndex = new Map<string, number>();
  private benchPacket = 0;
  private lcg = 1;
  private readonly link: MuseLink;
  private detail = "Model stream. 256 Hz, ten sites, blinks and noise included.";
  private bandUv: Record<BandId, number> = emptyBands();
  private quality = 0;
  private phaseError: number | null = null;
  private locked = false;
  private seeking = false;
  private peakHz = 10;
  private liveLock: number | null = null;
  private spark: number[] = Array.from({ length: 48 }, () => 0);

  private dropping = false;
  private readonly onDropped = (): void => {
    if (this.dropping) return;
    this.dropping = true;
    void this.link.disconnect().finally(() => {
      this.dropping = false;
    });
    this.fallBack("Headset dropped. The model stream is live again.");
  };

  constructor() {
    for (const electrode of ELECTRODES) {
      this.rings.set(electrode.id, new SampleRing(RING));
      this.pink.set(electrode.id, 0);
      this.smoothed.set(electrode.id, emptyBands());
      this.osc.set(
        electrode.id,
        BANDS.map((band) => ({
          band,
          phase: 0,
          amp: 8,
          freq: BAND_HZ[band],
        })),
      );
    }
    this.link = new MuseLink(
      {
        eeg: (channel, samples) => this.ingestNative(channel, samples),
        ppg: (channel, samples) => this.ingestPpg(channel, samples),
        accel: (samples) => this.ingestAccel(samples),
        gyro: (samples) => this.ingestGyro(samples),
        telemetry: (battery, temperature, cell) => {
          this.battery = battery;
          if (temperature != null) this.temperatureC = temperature;
          if (cell != null) this.cellV = cell;
        },
        info: (patch) => {
          if (patch.firmware) this.firmware = patch.firmware;
          if (patch.hardware) this.hardware = patch.hardware;
          if (patch.horseshoe) this.deviceHorseshoe = patch.horseshoe;
          if (patch.battery != null) this.battery = patch.battery;
        },
        gap: () => {
          this.gaps += 1;
        },
      },
      this.onDropped,
    );
    this.reseed();
  }

  get bluetooth(): boolean {
    return this.link.bluetooth;
  }

  setDrive(drive: EegDrive): void {
    const subjectChanged = drive.subject !== this.drive.subject;
    this.drive = drive;
    if (subjectChanged) this.reseed();
    if (!drive.sync || !drive.running || drive.paused) {
      this.integ *= 0.8;
      this.trim *= 0.8;
      if (Math.abs(this.trim) < 0.02) this.trim = 0;
    }
  }

  start(): void {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    this.lastModelNow = performance.now();
    this.lastAnalyze = this.lastModelNow;
    const tick = (now: number) => {
      if (!this.started) return;
      this.advanceModel(now);
      this.advanceBench(now);
      if (now - this.lastAnalyze >= ANALYZE_MS && this.mix.count >= EEG_WINDOW) {
        this.lastAnalyze = now;
        this.analyze();
      }
      this.raf = window.requestAnimationFrame(tick);
    };
    this.raf = window.requestAnimationFrame(tick);
  }

  stop(): void {
    this.started = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    void this.link.disconnect();
    this.fallBack("Model stream. 256 Hz, ten sites, blinks and noise included.");
  }

  async connectMuse(): Promise<void> {
    this.stopBenchQuiet();
    const session = await this.link.connect();
    this.resetLive();
    this.source = "muse";
    this.deviceName = session.name;
    this.family = session.family;
    this.preset = session.preset;
    this.detail = `${session.name} · ${session.preset}. Waiting for a full second of signal.`;
  }

  disconnectMuse(): void {
    void this.link.disconnect();
    this.fallBack("Headset released. The model stream is live again.");
  }

  startBench(kind: "classic" | "athena" = "classic"): void {
    void this.link.disconnect();
    this.resetLive();
    this.source = "bench";
    const athena = kind === "athena";
    this.deviceName = athena ? "Muse S Athena" : "Muse bench";
    this.family = athena ? "athena" : "classic";
    this.preset = athena ? ATHENA_DEFAULT_PRESET : "p50";
    this.firmware = athena ? "3.1-virtual" : "virtual";
    this.hardware = athena ? "athena" : "bench";
    this.battery = athena ? 76 : 81;
    this.temperatureC = 32.4;
    this.cellV = 3.7;
    this.benchEegCount = 0;
    this.ppgAcc = 0;
    this.imuAcc = 0;
    this.benchPpg = [];
    this.benchAcc = [];
    this.benchGyro = [];
    this.benchHold.clear();
    this.opticHold.clear();
    this.channelIndex.clear();
    this.lcg = fnv(this.drive.subject) || 1;
    this.lastModelNow = typeof performance !== "undefined" ? performance.now() : 0;
    this.detail = athena
      ? "Muse S Athena bench. Preset p1035: four electrodes and 730/850 nm optics."
      : "Signal bench. EEG, motion, pulse, and battery through the Muse decoders.";
  }

  stopBench(): void {
    if (this.source !== "bench") return;
    this.fallBack("Signal bench stopped. The model stream is live again.");
  }

  snapshot(): EegSnapshot {
    let sites: EegSnapshot["sites"] = null;
    if (this.analyzed) {
      sites = {};
      for (const electrode of ELECTRODES) {
        sites[electrode.id] = { ...(this.smoothed.get(electrode.id) ?? emptyBands()) };
      }
    }
    const active = this.drive.sync && this.drive.running && !this.drive.paused;
    const channels: EegChannel[] =
      this.source === "model"
        ? []
        : TRACE_ORDER.filter((id) => (this.native.get(id)?.count ?? 0) > 0).map((id) => ({
            id,
            fit: this.fits.get(id) ?? 2,
            live: true,
          }));
    return {
      source: this.source,
      deviceName: this.deviceName,
      sampleRate: EEG_RATE,
      quality: this.quality,
      phaseErrorDeg: active && this.phaseError !== null ? Math.round((this.phaseError * 180) / Math.PI) : null,
      locked: active && this.locked,
      seeking: active && !this.locked,
      trimHz: active ? Math.round(this.trim * 100) / 100 : 0,
      targetHz: BAND_HZ[nearestBand(this.drive.beat)],
      peakHz: Math.round(this.peakHz * 10) / 10,
      liveLock: this.liveLock,
      bandUv: { ...this.bandUv },
      sites,
      spark: this.spark.slice(),
      detail: this.detail,
      bluetooth: this.bluetooth,
      family: this.family,
      preset: this.preset,
      firmware: this.firmware,
      hardware: this.hardware,
      battery: this.battery,
      temperatureC: this.temperatureC,
      cellV: this.cellV,
      heartBpm: this.heartBpm,
      moving: this.moving,
      channels,
      optics: this.optics.slice(),
    };
  }

  /** Last ~2 s, 128 points, in µV. Live sources show the headset channels. */
  traces(): { id: string; samples: Float32Array }[] {
    if (this.source === "model") {
      return ELECTRODES.map((electrode) => ({ id: electrode.id, samples: this.traceOf(this.rings.get(electrode.id)) }));
    }
    return TRACE_ORDER.filter((id) => this.native.has(id)).map((id) => ({ id, samples: this.traceOf(this.native.get(id)) }));
  }

  private traceOf(ring: SampleRing | undefined): Float32Array {
    const samples = new Float32Array(128);
    const raw = new Float32Array(RING);
    if (!ring) return samples;
    const have = ring.copyLast(RING, raw);
    const step = Math.max(1, Math.floor(have / 128));
    const start = Math.max(0, have - step * 128);
    for (let i = 0; i < 128; i++) {
      const index = start + i * step;
      samples[i] = index < have ? raw[index] : 0;
    }
    return samples;
  }

  private reseed(): void {
    for (const electrode of ELECTRODES) {
      const bank = this.osc.get(electrode.id);
      if (!bank) continue;
      for (const osc of bank) {
        const global = ((fnv(`${this.drive.subject}|${osc.band}`) % 6283) / 1000) % (Math.PI * 2);
        const spread = ((fnv(`${electrode.id}|${osc.band}`) % 1000) / 1000 - 0.5) * 0.35;
        osc.phase = wrapPhase(global + spread);
      }
    }
  }

  private advanceSamplePhase(samples: number): void {
    if (samples <= 0) return;
    const hz = Math.max(0.4, this.drive.beat + this.trim);
    this.samplePhase = wrapPhase(this.samplePhase + (2 * Math.PI * hz * samples) / EEG_RATE);
  }

  private advanceModel(now: number): void {
    if (this.source !== "model") return;
    const dt = Math.min(0.25, Math.max(0, (now - this.lastModelNow) / 1000));
    this.lastModelNow = now;
    const steps = Math.max(0, Math.floor((dt + this.residual) * EEG_RATE));
    this.residual = dt + this.residual - steps / EEG_RATE;
    if (steps <= 0) return;

    const driven = nearestBand(this.drive.beat);
    const pull = this.drive.sync && this.drive.running && !this.drive.paused;
    const protocol = protocolById(this.drive.protocolId);
    const targets = new Map<string, Record<BandId, number>>();
    for (const electrode of ELECTRODES) {
      targets.set(
        electrode.id,
        siteBandPower(this.drive.subject, electrode.id, electrode.region, protocol, this.drive.elapsed),
      );
    }
    const miss = Math.abs(this.phaseError ?? Math.PI);

    for (let step = 0; step < steps; step++) {
      this.sampleTime += 1 / EEG_RATE;
      if (this.blinkUntil === 0 && this.sampleTime >= this.nextBlink) {
        this.blinkUntil = this.sampleTime + 0.26;
      }
      const blinking = this.blinkUntil > 0 && this.sampleTime <= this.blinkUntil;
      const blinkU = blinking ? Math.sin(((this.blinkUntil - this.sampleTime) / 0.26) * Math.PI) : 0;
      if (this.blinkUntil > 0 && this.sampleTime > this.blinkUntil) {
        this.blinkUntil = 0;
        this.nextBlink = this.sampleTime + 3.4 + Math.random() * 3.2;
      }
      let mix = 0;
      for (const electrode of ELECTRODES) {
        const bank = this.osc.get(electrode.id)!;
        const expected = targets.get(electrode.id)!;
        let value = 0;
        for (const osc of bank) {
          let target = 5 + expected[osc.band] * 16 + protocol.gains[osc.band] * 14;
          if (pull && osc.band === driven) target *= 1 + 0.45 * Math.exp(-miss * miss * 3);
          osc.amp += (target - osc.amp) * 0.004;
          osc.phase = wrapPhase(osc.phase + (2 * Math.PI * osc.freq) / EEG_RATE);
          value += osc.amp * Math.sin(osc.phase);
        }
        let pink = this.pink.get(electrode.id) ?? 0;
        pink = pink * 0.97 + (Math.random() * 2 - 1) * 1.8;
        this.pink.set(electrode.id, pink);
        value += pink + (Math.random() * 2 - 1) * 2.4;
        if (blinking && (electrode.id === "Fp1" || electrode.id === "Fp2")) {
          value += blinkU * (electrode.id === "Fp1" ? 80 : 58);
        }
        this.rings.get(electrode.id)!.push(value);
        mix += value;
      }
      this.mix.push(mix / ELECTRODES.length);
    }
    this.advanceSamplePhase(steps);
  }

  private ingestNative(channel: string, samples: number[]): void {
    if (this.source !== "muse" && this.source !== "bench") return;
    let ring = this.native.get(channel);
    if (!ring) {
      ring = new SampleRing(RING);
      this.native.set(channel, ring);
    }
    const drop = typeof performance !== "undefined" && performance.now() < this.motionDropUntil;
    const clock = channel === "AF7";
    for (const sample of samples) {
      if (drop) continue;
      ring.push(sample);
      if (clock) {
        this.mix.push(sample);
        this.advanceSamplePhase(1);
      }
    }
  }

  private ingestPpg(channel: string, samples: number[]): void {
    if (this.source !== "muse" && this.source !== "bench") return;
    const rank = PPG_RANK.indexOf(channel);
    const current = this.ppgPick ? PPG_RANK.indexOf(this.ppgPick) : -1;
    const better = rank >= 0 && (current < 0 || rank < current);
    if (this.ppgPick === null || better || channel === this.ppgPick) {
      if (better && channel !== this.ppgPick) {
        this.ppgPick = channel;
        this.ppgRing.clear();
        this.heartBpm = null;
      } else if (this.ppgPick === null) this.ppgPick = channel;
      if (channel === this.ppgPick) {
        for (const sample of samples) this.ppgRing.push(sample);
      }
    }
    if (this.family !== "athena") return;
    let mean = 0;
    for (const sample of samples) mean += sample;
    mean = samples.length ? mean / samples.length : 0;
    const base = (this.opticBase.get(channel) ?? mean) * 0.92 + mean * 0.08;
    this.opticBase.set(channel, base);
    const prev = this.optics.find((item) => item.id === channel)?.level ?? 0;
    const swing = Math.abs(mean - base) / Math.max(1, Math.abs(base));
    const level = Math.max(0, Math.min(1, prev * 0.7 + Math.min(1, swing * 28) * 0.3));
    const next = this.optics.filter((item) => item.id !== channel);
    next.push({ id: channel, level: Math.max(level, 0.06) });
    const order = new Map<string, number>(ATHENA_OPTIC_ORDER.map((id, index) => [id, index]));
    next.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
    this.optics = next;
  }

  private ingestAccel(samples: XYZ[]): void {
    if (this.source !== "muse" && this.source !== "bench") return;
    for (const sample of samples) {
      this.accels.push(Math.hypot(sample.x, sample.y, sample.z));
      if (this.accels.length > 32) this.accels.shift();
    }
    this.noteMotion();
  }

  private ingestGyro(samples: XYZ[]): void {
    if (this.source !== "muse" && this.source !== "bench") return;
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.hypot(sample.x, sample.y, sample.z));
    this.gyroPeak = this.gyroPeak * 0.8 + peak * 0.2;
    this.noteMotion();
  }

  private noteMotion(): void {
    if (this.accels.length < 4) return;
    let mean = 0;
    for (const value of this.accels) mean += value;
    mean /= this.accels.length;
    let variance = 0;
    for (const value of this.accels) variance += (value - mean) * (value - mean);
    const std = Math.sqrt(variance / this.accels.length);
    this.moving = Math.abs(mean - 1) > 0.28 || std > 0.12 || this.gyroPeak > 80;
    if (this.moving && typeof performance !== "undefined") this.motionDropUntil = performance.now() + 180;
  }

  private analyze(): void {
    const have = this.mix.copyLast(EEG_WINDOW, this.window);
    if (have < EEG_WINDOW) return;
    const beat = Math.max(0.5, this.drive.beat);
    const center = BAND_HZ[nearestBand(beat)];
    const neural = goertzel(this.window, center, EEG_RATE);
    const stim = new Float32Array(EEG_WINDOW);
    const end = this.samplePhase;
    let phase = end - (2 * Math.PI * center * (EEG_WINDOW - 1)) / EEG_RATE;
    for (let i = 0; i < EEG_WINDOW; i++) {
      stim[i] = Math.sin(phase);
      phase += (2 * Math.PI * center) / EEG_RATE;
    }
    const stimBin = goertzel(stim, center, EEG_RATE);
    const error = wrapPhase(neural.phase - stimBin.phase);
    this.phaseError = error;

    const active = this.drive.sync && this.drive.running && !this.drive.paused;
    const near = Math.abs(beat - center) <= 1.6;
    if (active && near && neural.mag > 1.5) {
      this.integ = Math.max(-0.6, Math.min(0.6, this.integ + error * 0.02));
      const next = Math.max(-TRIM_LIMIT, Math.min(TRIM_LIMIT, (error / (Math.PI * 2)) * 1.1 + this.integ));
      this.trim = next;
      this.lockStreak = Math.abs(error) < 0.38 ? this.lockStreak + 1 : 0;
      this.locked = this.lockStreak >= 4;
      this.seeking = !this.locked;
    } else {
      this.integ *= 0.85;
      this.trim *= 0.85;
      this.lockStreak = 0;
      this.locked = false;
      this.seeking = active;
    }

    if (this.source !== "model") {
      this.measureLive(near);
      return;
    }

    const sums: Record<BandId, number> = { delta: 0, theta: 0, alpha: 0, smr: 0, beta: 0, gamma: 0 };
    let qualityAcc = 0;
    let measuredSites = 0;
    for (const electrode of ELECTRODES) {
      const ring = this.rings.get(electrode.id);
      if (!ring) continue;
      this.window.fill(0);
      if (ring.copyLast(EEG_WINDOW, this.window) < EEG_WINDOW) continue;
      const measured = emptyBands();
      for (const band of BANDS) {
        const bin = goertzel(this.window, BAND_HZ[band], EEG_RATE);
        measured[band] = Math.max(0.02, Math.min(1.6, bin.mag / 30));
        sums[band] += bin.mag;
      }
      const prev = this.smoothed.get(electrode.id) ?? emptyBands();
      const next = emptyBands();
      for (const band of BANDS) next[band] = prev[band] * 0.78 + measured[band] * 0.22;
      this.smoothed.set(electrode.id, next);
      const peak = Math.max(...BANDS.map((band) => measured[band]));
      const mean = BANDS.reduce((sum, band) => sum + measured[band], 0) / BANDS.length;
      qualityAcc += Math.max(0, Math.min(1, (peak - mean) / (peak + 0.04)));
      measuredSites += 1;
    }
    if (measuredSites === 0) return;
    this.quality = qualityAcc / measuredSites;
    for (const band of BANDS) sums[band] /= measuredSites;
    this.bandUv = sums;
    let peakBand: BandId = "alpha";
    let peak = -1;
    for (const band of BANDS) {
      if (sums[band] > peak) {
        peak = sums[band];
        peakBand = band;
      }
    }
    this.peakHz = BAND_HZ[peakBand];
    this.liveLock = this.locked ? Math.min(1, 0.72 + 0.28 * this.quality) : Math.min(1, 0.18 + 0.55 * this.quality);
    this.analyzed = true;

    const full = new Float32Array(EEG_WINDOW);
    this.mix.copyLast(EEG_WINDOW, full);
    let max = 1;
    const spark: number[] = [];
    for (let i = 0; i < 48; i++) {
      const value = full[Math.min(EEG_WINDOW - 1, i * 5 + 4)];
      spark.push(value);
      max = Math.max(max, Math.abs(value));
    }
    this.spark = spark.map((value) => value / max);

    if (this.source === "model") {
      if (this.locked) this.detail = "Model stream locked to the measured rhythm.";
      else if (!this.drive.running && this.drive.sync) this.detail = "Sync is armed. Begin the session and the tone will hunt the rhythm.";
      else if (this.seeking && !near) this.detail = "Beat sits between bands. Sync waits until it is nearer one.";
      else if (this.seeking) this.detail = "Model stream seeking phase. The tone is trimming onto the rhythm.";
      else this.detail = "Model stream. 256 Hz, ten sites, blinks and noise included.";
    } else if (this.locked) {
      this.detail = `${this.deviceName ?? "Muse"} locked to the measured rhythm.`;
    } else if (!this.drive.running && this.drive.sync) {
      this.detail = `${this.deviceName ?? "Muse"} is streaming. Begin the session to phase-lock the tone.`;
    } else if (this.seeking && !near) {
      this.detail = `${this.deviceName ?? "Muse"} · beat sits between bands. Sync waits until it is nearer one.`;
    } else if (this.seeking) {
      this.detail = `${this.deviceName ?? "Muse"} seeking phase. The tone is trimming onto the rhythm.`;
    }
  }

  private measureLive(near: boolean): void {
    const native: Record<string, Record<BandId, number>> = {};
    const sums: Record<BandId, number> = { delta: 0, theta: 0, alpha: 0, smr: 0, beta: 0, gamma: 0 };
    const scratch = new Float32Array(EEG_WINDOW);
    let counted = 0;
    for (const [id, ring] of this.native) {
      if (ring.copyLast(EEG_WINDOW, scratch) < EEG_WINDOW) continue;
      const measured = emptyBands();
      for (const band of BANDS) {
        const bin = goertzel(scratch, BAND_HZ[band], EEG_RATE);
        measured[band] = Math.max(0.02, Math.min(1.6, bin.mag / 30));
        sums[band] += bin.mag;
      }
      native[id] = measured;
      const slot = HORSESHOE_ORDER.indexOf(id);
      const fromDevice = slot >= 0 ? this.deviceHorseshoe?.[slot] : undefined;
      this.fits.set(id, fromDevice === 1 || fromDevice === 2 || fromDevice === 4 ? fromDevice : contactFit(scratch));
      counted += 1;
    }
    if (counted === 0) return;
    const projected = projectSitePowers(native, ELECTRODES.map((electrode) => electrode.id));
    for (const electrode of ELECTRODES) {
      const measured = projected[electrode.id];
      if (!measured) continue;
      const prev = this.smoothed.get(electrode.id) ?? emptyBands();
      const next = emptyBands();
      for (const band of BANDS) next[band] = prev[band] * 0.72 + measured[band] * 0.28;
      this.smoothed.set(electrode.id, next);
    }
    for (const band of BANDS) sums[band] /= counted;
    this.bandUv = sums;
    let peakBand: BandId = "alpha";
    let peak = -1;
    for (const band of BANDS) {
      if (sums[band] > peak) {
        peak = sums[band];
        peakBand = band;
      }
    }
    this.peakHz = BAND_HZ[peakBand];
    const rated = HORSESHOE_ORDER.filter((id) => this.fits.has(id));
    const pool = rated.length ? rated : [...this.fits.keys()];
    let quality = 0;
    for (const id of pool) {
      const fit = this.fits.get(id) ?? 4;
      quality += fit === 1 ? 1 : fit === 2 ? 0.55 : 0.15;
    }
    this.quality = (pool.length ? quality / pool.length : 0) * (this.moving ? 0.45 : 1);
    const ppgHave = this.ppgRing.copyLast(this.ppgWindow.length, this.ppgWindow);
    if (ppgHave >= 128) {
      const bpm = heartRate(this.ppgWindow.subarray(0, ppgHave), 64);
      if (bpm != null) this.heartBpm = this.heartBpm == null ? bpm : this.heartBpm * 0.75 + bpm * 0.25;
    }
    this.liveLock = this.locked ? Math.min(1, 0.72 + 0.28 * this.quality) : Math.min(1, 0.18 + 0.55 * this.quality);
    if (this.quality < 0.35) {
      this.locked = false;
      this.liveLock = Math.min(this.liveLock, 0.2);
    }
    this.analyzed = true;
    this.paintSpark();
    this.liveDetail(near);
  }

  private paintSpark(): void {
    const full = new Float32Array(EEG_WINDOW);
    this.mix.copyLast(EEG_WINDOW, full);
    let max = 1;
    const spark: number[] = [];
    for (let i = 0; i < 48; i++) {
      const value = full[Math.min(EEG_WINDOW - 1, i * 5 + 4)];
      spark.push(value);
      max = Math.max(max, Math.abs(value));
    }
    this.spark = spark.map((value) => value / max);
  }

  private liveDetail(near: boolean): void {
    const name = this.deviceName ?? "Muse";
    const gap = this.gaps > 0 ? " A packet was skipped." : "";
    this.gaps = 0;
    if (this.moving) {
      this.detail = `${name} motion gate is holding samples so a head turn does not become a rhythm.${gap}`;
      return;
    }
    if (this.locked) this.detail = `${name} locked to the measured rhythm.${gap}`;
    else if (!this.drive.running && this.drive.sync) this.detail = `${name} is streaming. Begin the session to phase-lock the tone.${gap}`;
    else if (this.seeking && !near) this.detail = `${name} · beat sits between bands. Sync waits until it is nearer one.${gap}`;
    else if (this.seeking) this.detail = `${name} seeking phase. The tone is trimming onto the rhythm.${gap}`;
    else if (this.source === "bench" && this.family === "athena") this.detail = `Muse S Athena · ${this.preset ?? ATHENA_DEFAULT_PRESET}. Four electrodes and 730/850 nm optics.${gap}`;
    else if (this.source === "bench") this.detail = `Signal bench · ${this.preset ?? "p50"}. Four electrodes, pulse, and motion.${gap}`;
    else if (this.family === "athena") this.detail = `${name} · ${this.preset ?? ATHENA_DEFAULT_PRESET}. Forehead and ear electrodes, plus optics, projected onto the ten-site map.${gap}`;
    else this.detail = `${name} · ${this.preset ?? "live"}. Real electrodes projected onto the ten-site map.${gap}`;
  }

  private advanceBench(now: number): void {
    if (this.source !== "bench") return;
    const dt = Math.min(0.25, Math.max(0, (now - this.lastModelNow) / 1000));
    this.lastModelNow = now;
    const steps = Math.max(0, Math.floor((dt + this.residual) * EEG_RATE));
    this.residual = dt + this.residual - steps / EEG_RATE;
    if (steps <= 0) return;
    if (this.family === "athena") {
      this.advanceAthena(steps);
      return;
    }
    for (let i = 0; i < steps; i++) {
      const t = this.benchEegCount / EEG_RATE;
      this.benchEegCount += 1;
      for (const channel of CLASSIC_EEG) {
        const held = this.benchHold.get(channel) ?? [];
        held.push(this.benchUv(channel, t));
        while (held.length >= 12) {
          const slice = held.splice(0, 12);
          const index = (this.channelIndex.get(channel) ?? 0) & 0xffff;
          this.channelIndex.set(channel, index + 1);
          const decoded = decodeMuseEeg(encodeClassicEeg(index, slice));
          if (decoded) this.ingestNative(channel, decoded.samples);
        }
        this.benchHold.set(channel, held);
      }
      this.ppgAcc += 64 / EEG_RATE;
      if (this.ppgAcc >= 1) {
        this.ppgAcc -= 1;
        this.benchPpg.push(9_000_000 + 180_000 * Math.sin(2 * Math.PI * (72 / 60) * t));
        if (this.benchPpg.length >= 6) {
          const decoded = decodeClassicPpg(encodeClassicPpg(this.benchPacket & 0xffff, this.benchPpg.splice(0, 6)));
          this.benchPacket += 1;
          if (decoded) this.ingestPpg("IR", decoded.samples);
        }
      }
      this.imuAcc += 52 / EEG_RATE;
      if (this.imuAcc >= 1) {
        this.imuAcc -= 1;
        const sway = 0.012 * Math.sin(2 * Math.PI * 0.25 * t);
        this.benchAcc.push({ x: sway, y: 0, z: 1 });
        this.benchGyro.push({ x: sway * 30, y: 0, z: 0 });
        if (this.benchAcc.length >= 3) {
          const decodedAcc = decodeClassicImu(encodeClassicImu(this.benchPacket & 0xffff, this.benchAcc.splice(0, 3), ACC_SCALE), ACC_SCALE);
          const decodedGyro = decodeClassicImu(encodeClassicImu(this.benchPacket & 0xffff, this.benchGyro.splice(0, 3), GYRO_SCALE), GYRO_SCALE);
          if (decodedAcc) this.ingestAccel(decodedAcc.samples);
          if (decodedGyro) this.ingestGyro(decodedGyro.samples);
        }
      }
      if (this.benchEegCount % EEG_RATE === 0) {
        const telemetry = decodeTelemetry(encodeTelemetry(this.benchEegCount & 0xffff, 81, 3700, 3240));
        if (telemetry) {
          this.battery = telemetry.battery;
          this.temperatureC = telemetry.temperatureC;
          this.cellV = telemetry.cellV;
        }
      }
    }
  }

  private nextIndex(key: string): number {
    const value = this.channelIndex.get(key) ?? 0;
    this.channelIndex.set(key, (value + 1) & 0xff);
    return value;
  }

  private nextCounter(): number {
    return this.nextIndex("packet");
  }

  private advanceAthena(steps: number): void {
    for (let i = 0; i < steps; i++) {
      const t = this.benchEegCount / EEG_RATE;
      this.benchEegCount += 1;
      for (const channel of ATHENA_EEG_4) {
        const held = this.benchHold.get(channel) ?? [];
        held.push(this.benchUv(channel, t));
        this.benchHold.set(channel, held);
      }
      const ready = ATHENA_EEG_4.every((channel) => (this.benchHold.get(channel)?.length ?? 0) >= 4);
      if (ready) {
        const eeg = ATHENA_EEG_4.map((channel) => {
          const held = this.benchHold.get(channel) ?? [];
          const slice = held.splice(0, 4);
          this.benchHold.set(channel, held);
          return slice;
        });
        this.applyAthena(encodeAthenaNotification({ eeg, counter: this.nextCounter(), eegIndex: this.nextIndex("eeg") }));
      }
      this.ppgAcc += 64 / EEG_RATE;
      if (this.ppgAcc >= 1) {
        this.ppgAcc -= 1;
        for (const channel of ATHENA_OPTIC_NAMES) {
          const held = this.opticHold.get(channel) ?? [];
          held.push(this.opticSample(channel, t));
          this.opticHold.set(channel, held);
        }
        const opticsReady = ATHENA_OPTIC_NAMES.every((channel) => (this.opticHold.get(channel)?.length ?? 0) >= 3);
        if (opticsReady) {
          const optics = ATHENA_OPTIC_NAMES.map((channel) => {
            const held = this.opticHold.get(channel) ?? [];
            const slice = held.splice(0, 3);
            this.opticHold.set(channel, held);
            return slice;
          });
          this.applyAthena(encodeAthenaNotification({ optics, counter: this.nextCounter(), opticIndex: this.nextIndex("optics") }));
        }
      }
      this.imuAcc += 52 / EEG_RATE;
      if (this.imuAcc >= 1) {
        this.imuAcc -= 1;
        const sway = 0.012 * Math.sin(2 * Math.PI * 0.25 * t);
        this.benchAcc.push({ x: sway, y: 0, z: 1 });
        this.benchGyro.push({ x: sway * 30, y: 0, z: 0 });
        if (this.benchAcc.length >= 3) {
          this.applyAthena(
            encodeAthenaNotification({
              counter: this.nextCounter(),
              imuIndex: this.nextIndex("imu"),
              imu: { accel: this.benchAcc.splice(0, 3), gyro: this.benchGyro.splice(0, 3) },
            }),
          );
        }
      }
      if (this.benchEegCount % EEG_RATE === 0) {
        this.applyAthena(encodeAthenaNotification({ battery: 76, counter: this.nextCounter(), batteryIndex: this.nextIndex("battery") }));
      }
    }
  }

  private applyAthena(bytes: Uint8Array): void {
    if (this.source !== "muse" && this.source !== "bench") return;
    for (const chunk of decodeAthenaNotification(bytes)) {
      if (chunk.type === "eeg") {
        chunk.channels.forEach((channel, index) => this.ingestNative(channel, chunk.samples[index] ?? []));
      } else if (chunk.type === "optics") {
        chunk.channels.forEach((channel, index) => this.ingestPpg(channel, chunk.samples[index] ?? []));
      } else if (chunk.type === "imu") {
        this.ingestAccel(chunk.accel);
        this.ingestGyro(chunk.gyro);
      } else if (chunk.type === "battery") {
        this.battery = chunk.percent;
      }
    }
  }

  private opticSample(channel: string, t: number): number {
    const pulse = Math.sin(2 * Math.PI * 1.2 * t);
    const hemo = Math.sin(2 * Math.PI * 0.1 * t + (fnv(channel) % 20) / 10);
    const cardiac = channel.includes("850") || channel.endsWith("_IR");
    const base = cardiac ? 420_000 : 380_000;
    return base + (cardiac ? 14_000 : 4_000) * (cardiac ? pulse : hemo);
  }

  private benchUv(channel: string, t: number): number {
    const driven = nearestBand(this.drive.beat);
    const frontal = channel === "AF7" || channel === "AF8" || channel === "AUX1" || channel === "AUX2";
    let value = 0;
    for (const band of BANDS) {
      let amp = frontal
        ? band === "alpha"
          ? 16
          : band === "beta"
            ? 10
            : band === "theta"
              ? 6
              : band === "gamma"
                ? 4
                : 5
        : band === "alpha"
          ? 18
          : band === "theta"
            ? 12
            : band === "delta"
              ? 8
              : 4;
      if (this.drive.running && !this.drive.paused && band === driven) amp *= 2.2;
      const phase = (fnv(`${channel}|${band}`) % 628) / 100;
      value += amp * Math.sin(2 * Math.PI * BAND_HZ[band] * t + phase);
    }
    value += this.rand() * 1.4;
    const into = t % 5.5;
    if (into < 0.22 && frontal) {
      const blink = Math.sin((into / 0.22) * Math.PI);
      value += blink * (channel === "AF7" ? 70 : 48);
    }
    return value;
  }

  private rand(): number {
    this.lcg = (1664525 * this.lcg + 1013904223) >>> 0;
    return (this.lcg / 4294967296) * 2 - 1;
  }

  private resetLive(): void {
    this.native.clear();
    this.fits.clear();
    this.deviceHorseshoe = null;
    this.ppgRing.clear();
    this.ppgPick = null;
    this.accels.length = 0;
    this.gyroPeak = 0;
    this.motionDropUntil = 0;
    this.moving = false;
    this.gaps = 0;
    this.optics = [];
    this.opticBase.clear();
    this.heartBpm = null;
    this.mix.clear();
    this.analyzed = false;
    this.liveLock = null;
    this.locked = false;
    this.seeking = false;
    this.lockStreak = 0;
    this.trim = 0;
    this.integ = 0;
  }

  private stopBenchQuiet(): void {
    if (this.source !== "bench") return;
    this.source = "model";
    this.deviceName = null;
    this.family = "none";
    this.preset = null;
  }

  private fallBack(detail: string): void {
    this.resetLive();
    this.source = "model";
    this.deviceName = null;
    this.family = "none";
    this.preset = null;
    this.firmware = null;
    this.hardware = null;
    this.battery = null;
    this.temperatureC = null;
    this.cellV = null;
    this.lastModelNow = typeof performance !== "undefined" ? performance.now() : 0;
    this.detail = detail;
  }
}

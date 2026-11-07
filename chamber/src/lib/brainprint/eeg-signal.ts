/**
 * Pure EEG helpers: Goertzel bins, phase wrap, Muse 12-bit packets.
 * No browser APIs, so the math can be checked on its own.
 */

export const EEG_RATE = 256;
export const EEG_WINDOW = 256;

export function wrapPhase(rad: number): number {
  const tau = Math.PI * 2;
  let x = rad % tau;
  if (x <= -Math.PI) x += tau;
  else if (x > Math.PI) x -= tau;
  return x;
}

export type Bin = { mag: number; phase: number };

/** One DFT bin. `mag` is peak amplitude for a pure sine in `samples`. */
export function goertzel(samples: ArrayLike<number>, freq: number, sampleRate: number): Bin {
  const n = samples.length;
  if (n === 0 || freq <= 0) return { mag: 0, phase: 0 };
  const k = Math.round((n * freq) / sampleRate);
  const w = (2 * Math.PI * k) / n;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const real = s1 - s2 * Math.cos(w);
  const imag = s2 * Math.sin(w);
  return {
    mag: (Math.sqrt(real * real + imag * imag) * 2) / n,
    phase: Math.atan2(imag, real),
  };
}

const MUSE_UV = 0.48828125;

/** Muse EEG notification: 2-byte index + 12 samples of unsigned 12-bit µV. */
export function decodeMuseEeg(bytes: Uint8Array): { index: number; samples: number[] } | null {
  if (bytes.length < 20) return null;
  const index = (bytes[0] << 8) | bytes[1];
  const packed = bytes.subarray(2, 20);
  const raw: number[] = [];
  for (let i = 0; i < packed.length; i++) {
    if (i % 3 === 0) {
      if (i + 1 >= packed.length) break;
      raw.push((packed[i] << 4) | (packed[i + 1] >> 4));
    } else {
      if (i + 1 >= packed.length) break;
      raw.push(((packed[i] & 0x0f) << 8) | packed[i + 1]);
      i += 1;
    }
  }
  if (raw.length < 12) return null;
  return {
    index,
    samples: raw.slice(0, 12).map((value) => (value - 2048) * MUSE_UV),
  };
}

export class SampleRing {
  readonly buf: Float32Array;
  private cursor = 0;
  count = 0;
  last = 0;

  constructor(length: number) {
    this.buf = new Float32Array(length);
  }

  push(value: number): void {
    this.last = value;
    this.buf[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.buf.length;
    if (this.count < this.buf.length) this.count += 1;
  }

  clear(): void {
    this.buf.fill(0);
    this.cursor = 0;
    this.count = 0;
    this.last = 0;
  }

  /** Chronological copy of the last `n` samples into `into`. Returns how many. */
  copyLast(n: number, into: Float32Array): number {
    const have = Math.min(n, this.count, into.length);
    const len = this.buf.length;
    let start = this.cursor - have;
    if (start < 0) start += len;
    for (let i = 0; i < have; i++) into[i] = this.buf[(start + i) % len];
    return have;
  }
}

/**
 * Muse headset wire formats.
 *
 * Classic (Muse 2016, Muse 2, Muse S): one GATT characteristic per sensor.
 *   EEG 12-bit µV, PPG 24-bit, IMU int16, telemetry uint16. Presets p21 / p50.
 * Athena (Muse S, MS-03): every sensor is multiplexed on 273e0013 as
 *   tagged, bit-packed subpackets. 14-bit EEG centered at 8192, 20-bit
 *   optics, little-endian IMU. Default preset p1035 (4 EEG + 4 optics).
 *
 * Decoders are pure. The bench and the Bluetooth link both go through them.
 * Research instrument. Not a clinical EEG and not a medical device.
 */

import { BANDS, type BandId } from "./engine.ts";
import { decodeMuseEeg } from "./eeg-signal.ts";

export const MUSE_SERVICE = "0000fe8d-0000-1000-8000-00805f9b34fb";
export const MUSE_CONTROL = "273e0001-4c4d-454d-96be-f03bac821358";
export const MUSE_TELEMETRY = "273e000b-4c4d-454d-96be-f03bac821358";
export const MUSE_GYRO = "273e0009-4c4d-454d-96be-f03bac821358";
export const MUSE_ACCEL = "273e000a-4c4d-454d-96be-f03bac821358";
export const MUSE_ATHENA = "273e0013-4c4d-454d-96be-f03bac821358";
/** Usually quiet. Some firmware puts auxiliary Athena sensors here. */
export const MUSE_ATHENA_AUX = "273e0014-4c4d-454d-96be-f03bac821358";
export const MUSE_ATHENA_SECONDARY = "273e0015-4c4d-454d-96be-f03bac821358";

export const MUSE_EEG_UUID: Record<string, string> = {
  TP9: "273e0003-4c4d-454d-96be-f03bac821358",
  AF7: "273e0004-4c4d-454d-96be-f03bac821358",
  AF8: "273e0005-4c4d-454d-96be-f03bac821358",
  TP10: "273e0006-4c4d-454d-96be-f03bac821358",
  AUX: "273e0007-4c4d-454d-96be-f03bac821358",
};

export const MUSE_PPG_UUID = [
  ["AMBIENT", "273e000f-4c4d-454d-96be-f03bac821358"],
  ["IR", "273e0010-4c4d-454d-96be-f03bac821358"],
  ["RED", "273e0011-4c4d-454d-96be-f03bac821358"],
] as const;

export const CLASSIC_EEG = ["TP9", "AF7", "AF8", "TP10"] as const;
export const ACC_SCALE = 0.0000610352;
export const GYRO_SCALE = 0.0074768;
export const ATHENA_GYRO_SCALE = -0.0074768;
export const ATHENA_EEG_SCALE = 1450 / 16383;
export const ATHENA_EEG_MID = 8192;
/** 4 EEG + 4 optics, the low-power stream validated on MS-03 firmware. */
export const ATHENA_DEFAULT_PRESET = "p1035";

export const ATHENA_EEG_4 = ["TP9", "AF7", "AF8", "TP10"] as const;
export const ATHENA_EEG_NAMES = ["TP9", "AF7", "AF8", "TP10", "AUX1", "AUX2", "AUX3", "AUX4"] as const;
/** p1035 optics: left/right inner detectors, 730 nm then 850 nm. */
export const ATHENA_OPTIC_NAMES = ["LI_730", "RI_730", "LI_850", "RI_850"] as const;
export const ATHENA_OPTIC_ORDER = [
  "LO_730",
  "RO_730",
  "LO_850",
  "RO_850",
  "LI_730",
  "RI_730",
  "LI_850",
  "RI_850",
  "LO_RED",
  "RO_RED",
  "LO_AMB",
  "RO_AMB",
  "LI_RED",
  "RI_RED",
  "LI_AMB",
  "RI_AMB",
] as const;

const ATHENA_OPTICS: Record<number, readonly string[]> = {
  4: ATHENA_OPTIC_NAMES,
  8: ["LO_730", "RO_730", "LO_850", "RO_850", "LI_730", "RI_730", "LI_850", "RI_850"],
  16: ATHENA_OPTIC_ORDER,
};

/** Payload bytes after the 5-byte subpacket header. */
const ATHENA_TAGS: Record<number, { type: "eeg" | "optics" | "motion" | "battery"; channels: number; samples: number; bytes: number }> = {
  0x11: { type: "eeg", channels: 4, samples: 4, bytes: 28 },
  0x12: { type: "eeg", channels: 8, samples: 2, bytes: 28 },
  0x34: { type: "optics", channels: 4, samples: 3, bytes: 30 },
  0x35: { type: "optics", channels: 8, samples: 2, bytes: 40 },
  0x36: { type: "optics", channels: 16, samples: 1, bytes: 40 },
  0x47: { type: "motion", channels: 6, samples: 3, bytes: 36 },
  0x88: { type: "battery", channels: 1, samples: 1, bytes: 20 },
  0x98: { type: "battery", channels: 1, samples: 1, bytes: 20 },
};

/** How a Muse electrode lands on the ten-site map. Missing sensors are skipped. */
const SITE_WEIGHTS: Record<string, [string, number][]> = {
  Fp1: [
    ["AF7", 0.78],
    ["AUX1", 0.34],
    ["AUX_L", 0.22],
  ],
  Fp2: [
    ["AF8", 0.78],
    ["AUX", 0.3],
    ["AUX2", 0.34],
    ["AUX_R", 0.3],
  ],
  F3: [
    ["AF7", 0.62],
    ["TP9", 0.22],
    ["AUX1", 0.2],
    ["AUX3", 0.14],
    ["AUX_L", 0.16],
  ],
  F4: [
    ["AF8", 0.62],
    ["TP10", 0.22],
    ["AUX", 0.2],
    ["AUX2", 0.2],
    ["AUX4", 0.14],
    ["AUX_R", 0.2],
  ],
  C3: [
    ["TP9", 0.48],
    ["AF7", 0.18],
    ["AUX3", 0.16],
  ],
  C4: [
    ["TP10", 0.48],
    ["AF8", 0.18],
    ["AUX", 0.12],
    ["AUX4", 0.16],
  ],
  P3: [
    ["TP9", 0.8],
    ["AUX3", 0.18],
    ["AUX_L", 0.15],
  ],
  P4: [
    ["TP10", 0.8],
    ["AUX", 0.15],
    ["AUX4", 0.18],
  ],
  O1: [["TP9", 0.42]],
  O2: [["TP10", 0.42]],
};

export type XYZ = { x: number; y: number; z: number };
export type Contact = 1 | 2 | 4;

export type Telemetry = {
  sequenceId: number;
  battery: number;
  cellV: number | null;
  temperatureC: number | null;
};

export type AthenaChunk =
  | { type: "eeg"; channels: string[]; samples: number[][]; index: number; packetCounter: number }
  | { type: "imu"; accel: XYZ[]; gyro: XYZ[]; index: number; packetCounter: number }
  | { type: "optics"; channels: string[]; samples: number[][]; index: number; packetCounter: number }
  | { type: "battery"; percent: number; index: number; packetCounter: number };

export function encodeCommand(command: string): Uint8Array {
  const encoded = new TextEncoder().encode(`X${command}\n`);
  encoded[0] = encoded.length - 1;
  return encoded;
}

export function encodeClassicEeg(index: number, microvolts: number[]): Uint8Array {
  const bytes = new Uint8Array(20);
  bytes[0] = (index >> 8) & 0xff;
  bytes[1] = index & 0xff;
  const raw = microvolts.slice(0, 12).map((uv) => {
    const n = Math.round(uv / 0.48828125 + 2048);
    return Math.max(0, Math.min(4095, n));
  });
  while (raw.length < 12) raw.push(2048);
  for (let s = 0; s < 12; s += 2) {
    const a = raw[s] & 0xfff;
    const b = raw[s + 1] & 0xfff;
    const o = 2 + (s / 2) * 3;
    bytes[o] = (a >> 4) & 0xff;
    bytes[o + 1] = ((a & 0xf) << 4) | ((b >> 8) & 0xf);
    bytes[o + 2] = b & 0xff;
  }
  return bytes;
}

export function decodeClassicPpg(bytes: Uint8Array): { index: number; samples: number[] } | null {
  if (bytes.length < 20) return null;
  const index = (bytes[0] << 8) | bytes[1];
  const samples: number[] = [];
  for (let i = 2; i + 2 < 20; i += 3) {
    samples.push((bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]);
  }
  if (samples.length < 6) return null;
  return { index, samples: samples.slice(0, 6) };
}

export function encodeClassicPpg(index: number, samples: number[]): Uint8Array {
  const bytes = new Uint8Array(20);
  bytes[0] = (index >> 8) & 0xff;
  bytes[1] = index & 0xff;
  for (let i = 0; i < 6; i++) {
    const value = Math.max(0, Math.min(0xffffff, Math.round(samples[i] ?? 0)));
    const o = 2 + i * 3;
    bytes[o] = (value >> 16) & 0xff;
    bytes[o + 1] = (value >> 8) & 0xff;
    bytes[o + 2] = value & 0xff;
  }
  return bytes;
}

export function decodeClassicImu(bytes: Uint8Array, scale: number): { sequenceId: number; samples: XYZ[] } | null {
  if (bytes.length < 20) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sample = (offset: number): XYZ => ({
    x: scale * view.getInt16(offset),
    y: scale * view.getInt16(offset + 2),
    z: scale * view.getInt16(offset + 4),
  });
  return { sequenceId: view.getUint16(0), samples: [sample(2), sample(8), sample(14)] };
}

export function encodeClassicImu(sequenceId: number, samples: XYZ[], scale: number): Uint8Array {
  const bytes = new Uint8Array(20);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, sequenceId & 0xffff);
  const quant = (value: number) => Math.max(-32768, Math.min(32767, Math.round(value / scale)));
  samples.slice(0, 3).forEach((sample, index) => {
    const o = 2 + index * 6;
    view.setInt16(o, quant(sample.x));
    view.setInt16(o + 2, quant(sample.y));
    view.setInt16(o + 4, quant(sample.z));
  });
  return bytes;
}

export function temperatureC(raw: number): number | null {
  const c = raw > 200 ? raw / 100 : raw;
  if (!Number.isFinite(c) || c < 5 || c > 60) return null;
  return Math.round(c * 10) / 10;
}

export function decodeTelemetry(bytes: Uint8Array): Telemetry | null {
  if (bytes.length < 10) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const battery = view.getUint16(2) / 512;
  const cellRaw = view.getUint16(4) * 2.2;
  const cellV = cellRaw > 20 ? cellRaw / 1000 : cellRaw;
  return {
    sequenceId: view.getUint16(0),
    battery: Math.max(0, Math.min(100, battery)),
    cellV: cellV >= 2.5 && cellV <= 4.5 ? Math.round(cellV * 100) / 100 : null,
    temperatureC: temperatureC(view.getUint16(8)),
  };
}

export function encodeTelemetry(sequenceId: number, batteryPercent: number, cellMilliVolts: number, tempHundredths: number): Uint8Array {
  const bytes = new Uint8Array(10);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, sequenceId & 0xffff);
  view.setUint16(2, Math.round(Math.max(0, Math.min(100, batteryPercent)) * 512));
  view.setUint16(4, Math.round(cellMilliVolts / 2.2));
  view.setUint16(8, tempHundredths & 0xffff);
  return bytes;
}

export function consumeControl(buffer: string, chunk: string): { buffer: string; messages: Record<string, unknown>[] } {
  let rest = buffer + chunk;
  const messages: Record<string, unknown>[] = [];
  while (rest.length) {
    const start = rest.indexOf("{");
    const end = rest.indexOf("}");
    if (start < 0) {
      rest = "";
      break;
    }
    if (end < 0 || end < start) {
      rest = rest.slice(start).slice(-2000);
      break;
    }
    const slice = rest.slice(start, end + 1);
    try {
      const parsed = JSON.parse(slice) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) messages.push(parsed as Record<string, unknown>);
    } catch {
      /* a torn brace is discarded, the rest of the stream continues */
    }
    rest = rest.slice(end + 1);
  }
  return { buffer: rest, messages };
}

export function readHorseshoe(message: Record<string, unknown>): Contact[] | null {
  const raw = message.hs ?? message.hsi ?? message.horseshoe;
  if (!Array.isArray(raw)) return null;
  const fits = raw.filter((value): value is Contact => value === 1 || value === 2 || value === 4);
  return fits.length ? fits : null;
}

export function readBatteryPercent(message: Record<string, unknown>): number | null {
  const raw = message.bp ?? message.batt ?? message.battery;
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

/** 1 good, 2 weak, 4 off. From the waveform, when the headset does not send a horseshoe. */
export function contactFit(samples: ArrayLike<number>): Contact {
  const n = samples.length;
  if (n < 32) return 4;
  let sum = 0;
  let sum2 = 0;
  let rails = 0;
  for (let i = 0; i < n; i++) {
    const sample = samples[i];
    sum += sample;
    sum2 += sample * sample;
    if (Math.abs(sample) > 500) rails += 1;
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const rail = rails / n;
  if (std < 2 || std > 180 || rail > 0.05) return 4;
  if (std < 5 || std > 90 || rail > 0.02) return 2;
  return 1;
}

export function heartRate(samples: ArrayLike<number>, sampleRate: number): number | null {
  const n = samples.length;
  if (n < sampleRate * 2 || sampleRate <= 0) return null;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += samples[i];
  mean /= n;
  let varsum = 0;
  const centered = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    centered[i] = samples[i] - mean;
    varsum += centered[i] * centered[i];
  }
  const std = Math.sqrt(varsum / n);
  if (std < 1e-3) return null;
  const minGap = Math.floor(sampleRate * 0.33);
  const threshold = std * 0.45;
  const peaks: number[] = [];
  let last = -minGap;
  for (let i = 1; i < n - 1; i++) {
    if (i - last < minGap) continue;
    if (centered[i] > threshold && centered[i] >= centered[i - 1] && centered[i] > centered[i + 1]) {
      peaks.push(i);
      last = i;
    }
  }
  if (peaks.length < 2) return null;
  let interval = 0;
  for (let i = 1; i < peaks.length; i++) interval += peaks[i] - peaks[i - 1];
  interval /= peaks.length - 1;
  const bpm = (60 * sampleRate) / interval;
  if (bpm < 40 || bpm > 180) return null;
  return bpm;
}

export function projectSitePowers(
  native: Record<string, Record<BandId, number>>,
  sites: readonly string[],
): Record<string, Record<BandId, number>> {
  const out: Record<string, Record<BandId, number>> = {};
  for (const site of sites) {
    const weights = SITE_WEIGHTS[site] ?? [];
    let weightSum = 0;
    const acc = {} as Record<BandId, number>;
    for (const band of BANDS) acc[band] = 0;
    for (const [channel, weight] of weights) {
      const powers = native[channel];
      if (!powers || weight <= 0) continue;
      weightSum += weight;
      for (const band of BANDS) acc[band] += weight * (powers[band] ?? 0);
    }
    if (weightSum <= 0) continue;
    for (const band of BANDS) acc[band] /= weightSum;
    out[site] = acc;
  }
  return out;
}

/** Little-endian bitstream, least-significant bit first. */
function unpackBits(bytes: Uint8Array, offset: number, count: number, bits: number): number[] {
  const values: number[] = [];
  const mask = (1 << bits) - 1;
  let acc = 0;
  let accBits = 0;
  let pos = offset;
  for (let i = 0; i < count; i++) {
    while (accBits < bits) {
      acc |= (bytes[pos] ?? 0) << accBits;
      pos += 1;
      accBits += 8;
    }
    values.push(acc & mask);
    acc >>>= bits;
    accBits -= bits;
  }
  return values;
}

function packBits(values: number[], bits: number, byteLength: number): Uint8Array {
  const out = new Uint8Array(byteLength);
  const mask = (1 << bits) - 1;
  let bit = 0;
  for (const value of values) {
    const kept = value & mask;
    for (let b = 0; b < bits; b += 1, bit += 1) {
      if ((kept >> b) & 1) out[bit >> 3] |= 1 << (bit & 7);
    }
  }
  return out;
}

function deinterleave(values: number[], channels: number, samples: number, scale = 1, offset = 0): number[][] {
  const out: number[][] = [];
  for (let channel = 0; channel < channels; channel += 1) {
    const column: number[] = [];
    for (let sample = 0; sample < samples; sample += 1) {
      column.push(((values[sample * channels + channel] ?? 0) - offset) * scale);
    }
    out.push(column);
  }
  return out;
}

function athenaNames(tag: number, channels: number): string[] {
  if (tag === 0x11 || tag === 0x12) return (channels === 4 ? ATHENA_EEG_4 : ATHENA_EEG_NAMES).slice(0, channels);
  return [...(ATHENA_OPTICS[channels] ?? Array.from({ length: channels }, (_, i) => `OPT${i}`))];
}

function decodeAthenaPayload(
  spec: (typeof ATHENA_TAGS)[number],
  tag: number,
  bytes: Uint8Array,
  payloadAt: number,
  index: number,
  packetCounter: number,
): AthenaChunk | null {
  if (spec.type === "eeg") {
    const raw = unpackBits(bytes, payloadAt, spec.channels * spec.samples, 14);
    return {
      type: "eeg",
      channels: athenaNames(tag, spec.channels),
      samples: deinterleave(raw, spec.channels, spec.samples, ATHENA_EEG_SCALE, ATHENA_EEG_MID),
      index,
      packetCounter,
    };
  }
  if (spec.type === "optics") {
    const raw = unpackBits(bytes, payloadAt, spec.channels * spec.samples, 20);
    return {
      type: "optics",
      channels: athenaNames(tag, spec.channels),
      samples: deinterleave(raw, spec.channels, spec.samples),
      index,
      packetCounter,
    };
  }
  if (spec.type === "motion") {
    const view = new DataView(bytes.buffer, bytes.byteOffset + payloadAt, spec.bytes);
    const accel: XYZ[] = [];
    const gyro: XYZ[] = [];
    for (let sample = 0; sample < 3; sample += 1) {
      const at = sample * 12;
      accel.push({
        x: view.getInt16(at, true) / 16384,
        y: view.getInt16(at + 2, true) / 16384,
        z: view.getInt16(at + 4, true) / 16384,
      });
      gyro.push({
        x: view.getInt16(at + 6, true) * ATHENA_GYRO_SCALE,
        y: view.getInt16(at + 8, true) * ATHENA_GYRO_SCALE,
        z: view.getInt16(at + 10, true) * ATHENA_GYRO_SCALE,
      });
    }
    return { type: "imu", accel, gyro, index, packetCounter };
  }
  if (spec.type === "battery") {
    const percent = (bytes[payloadAt] | ((bytes[payloadAt + 1] ?? 0) << 8)) / 256;
    return { type: "battery", percent, index, packetCounter };
  }
  return null;
}

/**
 * Athena notification: one or more packets.
 * Packet: [length][uint16 counter][6 clock bytes][subpackets].
 * Subpacket: [tag][uint8 index][3 metadata][payload].
 * An unknown tag ends that packet; the next packet is still read.
 */
export function decodeAthenaNotification(bytes: Uint8Array): AthenaChunk[] {
  const out: AthenaChunk[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const length = bytes[offset];
    if (length < 14 || offset + length > bytes.length) break;
    const end = offset + length;
    const packetCounter = bytes[offset + 1] | (bytes[offset + 2] << 8);
    let cursor = offset + 9;
    while (cursor + 5 <= end) {
      const tag = bytes[cursor];
      if (tag === 0x53) {
        if (cursor + 29 > end) break;
        cursor += 29;
        continue;
      }
      const spec = ATHENA_TAGS[tag];
      if (!spec || cursor + 5 + spec.bytes > end) break;
      const index = bytes[cursor + 1];
      const chunk = decodeAthenaPayload(spec, tag, bytes, cursor + 5, index, packetCounter);
      if (chunk) out.push(chunk);
      cursor += 5 + spec.bytes;
    }
    offset = end;
  }
  return out;
}

export type AthenaFrame = {
  /** Microvolts, channel-major. 4 channels → 4 samples (tag 0x11); 8 → 2 samples (tag 0x12). */
  eeg?: number[][];
  /** Raw 20-bit optics, channel-major. 4, 8, or 16 channels. */
  optics?: number[][];
  imu?: { accel: XYZ[]; gyro: XYZ[] };
  /** Battery percent, 0–100. */
  battery?: number;
  counter?: number;
  eegIndex?: number;
  opticIndex?: number;
  imuIndex?: number;
  batteryIndex?: number;
};

function athenaSubpacket(tag: number, index: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.length);
  out[0] = tag;
  out[1] = index & 0xff;
  out.set(payload, 5);
  return out;
}

/** One Athena packet. Sensors present are packed in optics, battery, motion, EEG order. */
export function encodeAthenaNotification(frame: AthenaFrame): Uint8Array {
  const parts: Uint8Array[] = [];
  if (frame.optics && (frame.optics.length === 4 || frame.optics.length === 8 || frame.optics.length === 16)) {
    const channels = frame.optics.length;
    const samples = channels === 4 ? 3 : channels === 8 ? 2 : 1;
    const tag = channels === 4 ? 0x34 : channels === 8 ? 0x35 : 0x36;
    const values: number[] = [];
    for (let sample = 0; sample < samples; sample += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        values.push(Math.max(0, Math.min(0xfffff, Math.round(frame.optics[channel]?.[sample] ?? 0))));
      }
    }
    parts.push(athenaSubpacket(tag, frame.opticIndex ?? 0, packBits(values, 20, channels === 4 ? 30 : 40)));
  }
  if (frame.battery != null) {
    const payload = new Uint8Array(20);
    const raw = Math.max(0, Math.min(0xffff, Math.round(frame.battery * 256)));
    payload[0] = raw & 0xff;
    payload[1] = (raw >> 8) & 0xff;
    parts.push(athenaSubpacket(0x88, frame.batteryIndex ?? 0, payload));
  }
  if (frame.imu && frame.imu.accel.length >= 3 && frame.imu.gyro.length >= 3) {
    const data = new Uint8Array(36);
    const view = new DataView(data.buffer);
    const quant = (value: number, scale: number) => Math.max(-32768, Math.min(32767, Math.round(value / scale)));
    for (let sample = 0; sample < 3; sample += 1) {
      const accel = frame.imu.accel[sample];
      const gyro = frame.imu.gyro[sample];
      const at = sample * 12;
      view.setInt16(at, quant(accel.x, 1 / 16384), true);
      view.setInt16(at + 2, quant(accel.y, 1 / 16384), true);
      view.setInt16(at + 4, quant(accel.z, 1 / 16384), true);
      view.setInt16(at + 6, quant(gyro.x, ATHENA_GYRO_SCALE), true);
      view.setInt16(at + 8, quant(gyro.y, ATHENA_GYRO_SCALE), true);
      view.setInt16(at + 10, quant(gyro.z, ATHENA_GYRO_SCALE), true);
    }
    parts.push(athenaSubpacket(0x47, frame.imuIndex ?? 0, data));
  }
  if (frame.eeg && (frame.eeg.length === 4 || frame.eeg.length >= 8)) {
    const channels = frame.eeg.length >= 8 ? 8 : 4;
    const samples = channels === 8 ? 2 : 4;
    const values: number[] = [];
    for (let sample = 0; sample < samples; sample += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const raw = Math.round(ATHENA_EEG_MID + (frame.eeg[channel]?.[sample] ?? 0) / ATHENA_EEG_SCALE);
        values.push(Math.max(0, Math.min(16383, raw)));
      }
    }
    parts.push(athenaSubpacket(channels === 8 ? 0x12 : 0x11, frame.eegIndex ?? 0, packBits(values, 14, 28)));
  }
  if (parts.length === 0) return new Uint8Array();
  let body = 0;
  for (const part of parts) body += part.length;
  const length = 9 + body;
  const out = new Uint8Array(length);
  const counter = frame.counter ?? 0;
  out[0] = length & 0xff;
  out[1] = counter & 0xff;
  out[2] = (counter >> 8) & 0xff;
  let cursor = 9;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

export { decodeMuseEeg };

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contactFit,
  decodeAthenaNotification,
  decodeClassicImu,
  decodeClassicPpg,
  decodeMuseEeg,
  decodeTelemetry,
  encodeClassicEeg,
  encodeClassicImu,
  encodeClassicPpg,
  encodeCommand,
  encodeTelemetry,
  heartRate,
  projectSitePowers,
  readHorseshoe,
  consumeControl,
  ACC_SCALE,
  GYRO_SCALE,
  ATHENA_EEG_4,
  ATHENA_EEG_MID,
  ATHENA_EEG_SCALE,
  ATHENA_OPTIC_NAMES,
  encodeAthenaNotification,
} from "./muse-protocol.ts";

describe("classic muse packets", () => {
  it("round-trips twelve EEG samples", () => {
    const samples = [0, 12.5, -40, 80, 3, -3, 100, -100, 7, 8, 9, 10];
    const packet = decodeMuseEeg(encodeClassicEeg(0x0102, samples));
    assert.ok(packet);
    assert.equal(packet.index, 0x0102);
    packet.samples.forEach((sample, index) => {
      assert.ok(Math.abs(sample - samples[index]) < 0.3, `${sample} vs ${samples[index]}`);
    });
  });

  it("round-trips PPG, IMU, and telemetry", () => {
    const ppg = decodeClassicPpg(encodeClassicPpg(7, [1000, 2000, 3000, 4000, 5000, 6000]));
    assert.deepEqual(ppg, { index: 7, samples: [1000, 2000, 3000, 4000, 5000, 6000] });
    const imu = decodeClassicImu(encodeClassicImu(4, [{ x: 0, y: 0, z: 1 }, { x: 0.1, y: -0.2, z: 0.9 }, { x: 0, y: 0, z: 1 }], ACC_SCALE), ACC_SCALE);
    assert.ok(imu);
    assert.ok(Math.abs(imu.samples[0].z - 1) < 1e-3);
    assert.ok(Math.abs(imu.samples[1].y + 0.2) < 1e-3);
    const gyro = decodeClassicImu(encodeClassicImu(1, [{ x: 10, y: 0, z: -5 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }], GYRO_SCALE), GYRO_SCALE);
    assert.ok(gyro);
    assert.ok(Math.abs(gyro.samples[0].x - 10) < 0.02);
    const telemetry = decodeTelemetry(encodeTelemetry(3, 81, 3700, 3240));
    assert.ok(telemetry);
    assert.equal(telemetry.sequenceId, 3);
    assert.ok(Math.abs(telemetry.battery - 81) < 0.3);
    assert.equal(telemetry.temperatureC, 32.4);
    assert.ok(telemetry.cellV && Math.abs(telemetry.cellV - 3.7) < 0.05);
  });

  it("encodes the halt command the headset expects", () => {
    assert.deepEqual(Array.from(encodeCommand("h")), [0x02, 0x68, 0x0a]);
    assert.deepEqual(Array.from(encodeCommand("p1035")), [0x06, 0x70, 0x31, 0x30, 0x33, 0x35, 0x0a]);
  });
});

describe("athena framing", () => {
  function packBits(values: number[], bits: number, byteLength: number): number[] {
    const out = new Uint8Array(byteLength);
    let bit = 0;
    for (const value of values) {
      for (let b = 0; b < bits; b += 1, bit += 1) {
        if ((value >> b) & 1) out[bit >> 3] |= 1 << (bit & 7);
      }
    }
    return [...out];
  }

  const subpacket = (tag: number, index: number, payload: number[]) => [tag, index, 0xaa, 0xbb, 0xcc, ...payload];

  function packet(counter: number, ...parts: number[][]): Uint8Array {
    const body = parts.flat();
    const length = 9 + body.length;
    return Uint8Array.from([length, counter & 0xff, counter >> 8, 1, 2, 3, 0x89, 0x93, 0x01, ...body]);
  }

  const eeg4 = (index: number, rows: number[][]) => subpacket(0x11, index, packBits(rows.flat(), 14, 28));

  it("reads 4-channel EEG centered at 8192, sample-major", () => {
    const rows = [0, 1, 2, 3].map((sample) => [0, 1, 2, 3].map((channel) => ATHENA_EEG_MID + 100 * channel + sample));
    const chunks = decodeAthenaNotification(packet(7, eeg4(5, rows)));
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].type, "eeg");
    if (chunks[0].type !== "eeg") return;
    assert.deepEqual(chunks[0].channels, [...ATHENA_EEG_4]);
    assert.equal(chunks[0].index, 5);
    assert.equal(chunks[0].packetCounter, 7);
    assert.equal(chunks[0].samples[0][0], 0);
    chunks[0].samples[2].forEach((value, index) => {
      assert.ok(Math.abs(value - (200 + index) * ATHENA_EEG_SCALE) < 1e-6);
    });
  });

  it("decodes optics, battery, and motion in one packet, then a second packet", () => {
    const optics = subpacket(0x34, 1, packBits(Array.from({ length: 12 }, (_, i) => 1000 * i), 20, 30));
    const motion = new Uint8Array(36);
    const view = new DataView(motion.buffer);
    for (let sample = 0; sample < 3; sample += 1) {
      view.setInt16((sample * 6) * 2, 16384, true);
      view.setInt16((sample * 6 + 3) * 2, -100, true);
    }
    const battery = subpacket(0x88, 3, [0x00, 0x3a, ...new Array(18).fill(0xee)]);
    const rows = [0, 1, 2, 3].map(() => [ATHENA_EEG_MID, ATHENA_EEG_MID, ATHENA_EEG_MID, ATHENA_EEG_MID]);
    const first = packet(1, optics, battery, subpacket(0x47, 2, [...motion]), eeg4(9, rows));
    const second = packet(2, eeg4(10, rows));
    const bytes = new Uint8Array(first.length + second.length);
    bytes.set(first, 0);
    bytes.set(second, first.length);
    const chunks = decodeAthenaNotification(bytes);
    assert.deepEqual(chunks.map((chunk) => chunk.type), ["optics", "battery", "imu", "eeg", "eeg"]);
    const optic = chunks[0];
    const cell = chunks[1];
    const imu = chunks[2];
    if (optic.type !== "optics" || cell.type !== "battery" || imu.type !== "imu") return;
    assert.deepEqual(optic.channels, [...ATHENA_OPTIC_NAMES]);
    assert.deepEqual(optic.samples[1], [1000, 5000, 9000]);
    assert.equal(cell.percent, 58);
    assert.deepEqual(imu.accel.map((sample) => sample.x), [1, 1, 1]);
    assert.ok(Math.abs(imu.gyro[0].x - 0.74768) < 1e-6);
    assert.equal(chunks[4].type === "eeg" && chunks[4].index, 10);
  });

  it("skips an unknown tag and still reads the next packet", () => {
    const rows = [0, 1, 2, 3].map(() => [ATHENA_EEG_MID, ATHENA_EEG_MID, ATHENA_EEG_MID, ATHENA_EEG_MID]);
    const bad = packet(1, subpacket(0x77, 0, [1, 2, 3, 4]), eeg4(0, rows));
    const good = packet(2, eeg4(1, rows));
    const bytes = new Uint8Array(bad.length + good.length);
    bytes.set(bad, 0);
    bytes.set(good, bad.length);
    const chunks = decodeAthenaNotification(bytes);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].type, "eeg");
    if (chunks[0].type !== "eeg") return;
    assert.equal(chunks[0].index, 1);
  });

  it("reads 8-channel EEG and round-trips a p1035 frame", () => {
    const values = Array.from({ length: 16 }, (_, i) => ATHENA_EEG_MID + i);
    const eight = decodeAthenaNotification(packet(1, subpacket(0x12, 0, packBits(values, 14, 28))));
    assert.equal(eight[0].type, "eeg");
    if (eight[0].type !== "eeg") return;
    assert.deepEqual(eight[0].channels, ["TP9", "AF7", "AF8", "TP10", "AUX1", "AUX2", "AUX3", "AUX4"]);
    assert.equal(eight[0].samples[0][0], 0);
    assert.ok(Math.abs(eight[0].samples[7][1] - 15 * ATHENA_EEG_SCALE) < 1e-6);

    const frame = encodeAthenaNotification({
      counter: 4,
      eegIndex: 2,
      opticIndex: 1,
      eeg: [
        [0, 12, -4, 8],
        [1, 2, 3, 4],
        [-20, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      optics: [
        [400000, 410000, 390000],
        [1, 2, 3],
        [500, 500, 500],
        [9, 9, 9],
      ],
      battery: 76,
      imu: {
        accel: [
          { x: 0, y: 0, z: 1 },
          { x: 0, y: 0, z: 1 },
          { x: 0, y: 0, z: 1 },
        ],
        gyro: [
          { x: 10, y: 0, z: 0 },
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 0 },
        ],
      },
    });
    const back = decodeAthenaNotification(frame);
    assert.deepEqual(back.map((chunk) => chunk.type), ["optics", "battery", "imu", "eeg"]);
    const decodedEeg = back.find((chunk) => chunk.type === "eeg");
    const decodedOptics = back.find((chunk) => chunk.type === "optics");
    const decodedCell = back.find((chunk) => chunk.type === "battery");
    if (!decodedEeg || decodedEeg.type !== "eeg" || !decodedOptics || decodedOptics.type !== "optics" || !decodedCell || decodedCell.type !== "battery") return;
    assert.ok(Math.abs(decodedEeg.samples[0][1] - 12) < 0.1);
    assert.equal(decodedEeg.index, 2);
    assert.deepEqual(decodedOptics.samples[0], [400000, 410000, 390000]);
    assert.equal(decodedCell.percent, 76);
  });
});

describe("live measures", () => {
  it("scores contact from the waveform", () => {
    const flat = new Float32Array(256);
    assert.equal(contactFit(flat), 4);
    const good = new Float32Array(256);
    for (let i = 0; i < good.length; i++) good[i] = 20 * Math.sin((2 * Math.PI * 10 * i) / 256);
    assert.equal(contactFit(good), 1);
  });

  it("reads a 72 bpm optical pulse", () => {
    const rate = 64;
    const n = rate * 8;
    const samples = new Float64Array(n);
    for (let i = 0; i < n; i++) samples[i] = 9_000_000 + 180_000 * Math.sin((2 * Math.PI * 1.2 * i) / rate);
    const bpm = heartRate(samples, rate);
    assert.ok(bpm != null && Math.abs(bpm - 72) < 3, `bpm ${bpm}`);
  });

  it("projects real electrodes onto the ten-site map", () => {
    const one = { delta: 0, theta: 0, alpha: 1, smr: 0, beta: 0, gamma: 0 };
    const zero = { delta: 0, theta: 0, alpha: 0, smr: 0, beta: 0, gamma: 0 };
    const sites = projectSitePowers({ AF7: one, TP9: zero }, ["Fp1", "O1", "O2"]);
    assert.ok(sites.Fp1.alpha > 0.9);
    assert.ok(sites.O1.alpha < 0.05);
    assert.equal(sites.O2, undefined);
  });

  it("collects horseshoe JSON torn across notifications", () => {
    const first = consumeControl("", '{"fw":"1.4.2","hw":"3.1"}{"hs":[1,2,');
    assert.equal(first.messages[0].fw, "1.4.2");
    const second = consumeControl(first.buffer, "1,4]}");
    assert.deepEqual(readHorseshoe(second.messages[0]), [1, 2, 1, 4]);
  });
});

describe("signal bench", () => {
  it("drives contact, pulse, and the ten-site map", async () => {
    let now = 0;
    const windowStub = {
      requestAnimationFrame(cb: (time: number) => void) {
        return setTimeout(() => {
          now += 20;
          cb(now);
        }, 0) as unknown as number;
      },
      setInterval,
      clearInterval,
    };
    Object.assign(globalThis, {
      window: windowStub,
      performance: { now: () => now },
      requestAnimationFrame: windowStub.requestAnimationFrame,
      cancelAnimationFrame: clearTimeout,
    });
    const { LiveEeg } = await import("./eeg.ts");
    const eeg = new LiveEeg();
    eeg.start();
    eeg.startBench();
    await new Promise((resolve) => setTimeout(resolve, 700));
    const snap = eeg.snapshot();
    eeg.stop();
    assert.equal(snap.source, "bench");
    assert.equal(snap.preset, "p50");
    assert.ok(snap.channels.length >= 4, JSON.stringify(snap.channels));
    for (const channel of snap.channels) assert.equal(channel.fit, 1, channel.id);
    assert.ok(snap.heartBpm != null && Math.abs(snap.heartBpm - 72) < 4, String(snap.heartBpm));
    assert.ok((snap.battery ?? 0) > 80);
    assert.equal(snap.moving, false);
    assert.ok((snap.sites?.Fp1.alpha ?? 0) > 0.2);
    assert.ok((snap.sites?.O1.alpha ?? 0) > 0.05);
  });

  it("drives a Muse S Athena p1035 bench through the real packets", async () => {
    let now = 0;
    const windowStub = {
      requestAnimationFrame(cb: (time: number) => void) {
        return setTimeout(() => {
          now += 20;
          cb(now);
        }, 0) as unknown as number;
      },
      setInterval,
      clearInterval,
    };
    Object.assign(globalThis, {
      window: windowStub,
      performance: { now: () => now },
      requestAnimationFrame: windowStub.requestAnimationFrame,
      cancelAnimationFrame: clearTimeout,
    });
    const { LiveEeg } = await import("./eeg.ts");
    const eeg = new LiveEeg();
    eeg.start();
    eeg.startBench("athena");
    await new Promise((resolve) => setTimeout(resolve, 700));
    const snap = eeg.snapshot();
    eeg.stop();
    assert.equal(snap.family, "athena");
    assert.equal(snap.preset, "p1035");
    assert.deepEqual(
      snap.channels.map((channel) => channel.id),
      ["TP9", "AF7", "AF8", "TP10"],
    );
    for (const channel of snap.channels) assert.equal(channel.fit, 1, channel.id);
    assert.deepEqual(
      snap.optics.map((optic) => optic.id),
      ["LI_730", "RI_730", "LI_850", "RI_850"],
    );
    assert.ok(snap.heartBpm != null && Math.abs(snap.heartBpm - 72) < 4, String(snap.heartBpm));
    assert.ok(Math.abs((snap.battery ?? 0) - 76) < 0.2);
    assert.equal(snap.moving, false);
    assert.ok((snap.sites?.Fp1.alpha ?? 0) > 0.2);
  });
});

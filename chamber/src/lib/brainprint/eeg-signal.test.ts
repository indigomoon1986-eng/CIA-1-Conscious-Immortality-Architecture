import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeMuseEeg, goertzel, wrapPhase } from "./eeg-signal.ts";

describe("goertzel", () => {
  it("recovers the peak of a pure sine", () => {
    const n = 256;
    const samples = new Float32Array(n);
    for (let i = 0; i < n; i++) samples[i] = 10 * Math.sin((2 * Math.PI * 10 * i) / n);
    const bin = goertzel(samples, 10, n);
    assert.ok(Math.abs(bin.mag - 10) < 0.05, `mag ${bin.mag}`);
  });

  it("sees a right-angle phase shift", () => {
    const n = 256;
    const a = new Float32Array(n);
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = (2 * Math.PI * 10 * i) / n;
      a[i] = Math.sin(t);
      b[i] = Math.sin(t + Math.PI / 2);
    }
    const delta = wrapPhase(goertzel(b, 10, n).phase - goertzel(a, 10, n).phase);
    assert.ok(Math.abs(delta - Math.PI / 2) < 0.05, `delta ${delta}`);
  });
});

describe("decodeMuseEeg", () => {
  it("unpacks twelve samples and a packet index", () => {
    const bytes = new Uint8Array(20);
    bytes[0] = 0x01;
    bytes[1] = 0x02;
    for (let i = 0; i < 6; i++) {
      const o = 2 + i * 3;
      bytes[o] = 0x80;
      bytes[o + 1] = 0x08;
      bytes[o + 2] = 0x00;
    }
    const packet = decodeMuseEeg(bytes);
    assert.ok(packet);
    assert.equal(packet.index, 0x0102);
    assert.equal(packet.samples.length, 12);
    for (const sample of packet.samples) assert.ok(Math.abs(sample) < 1e-6);
  });

  it("rejects a short notification", () => {
    assert.equal(decodeMuseEeg(new Uint8Array(8)), null);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ZeusError,
  drawSword,
  fileInner,
  nearCodes,
  packageJson,
  readPackage,
  returnSword,
  rhythmDistance,
  rhythmFromBands,
  textInner,
  type SwordWitness,
} from "./zeus.ts";

const bands = { delta: 2, theta: 3, alpha: 10, smr: 2, beta: 4, gamma: 1 };

function witness(code = rhythmFromBands(bands)): SwordWitness {
  return {
    subject: "did:monarch:session",
    family: "athena",
    preset: "p1035",
    source: "bench",
    device: "Muse S Athena",
    code,
  };
}

describe("sword in the stone", () => {
  it("quantizes the band shape and stays still when the scale changes", () => {
    const a = rhythmFromBands(bands);
    const b = rhythmFromBands({ delta: 4, theta: 6, alpha: 20, smr: 4, beta: 8, gamma: 2 });
    assert.deepEqual(a, b);
    assert.equal(a.length, 6);
    assert.ok(nearCodes(a).some((code) => rhythmDistance(a, code) === 0));
  });

  it("draws and returns a text package, including a one-bin drift", async () => {
    const live = witness();
    const pkg = await drawSword({
      phrase: "draw the sword",
      witness: live,
      inner: textInner("the vault keeps the night"),
      iterations: 1000,
      now: "2026-11-07T00:00:00.000Z",
    });
    const opened = await returnSword(packageJson(pkg), "draw the sword", live.code);
    assert.equal(opened.opened.t, "text");
    if (opened.opened.t === "text") assert.equal(opened.opened.body, "the vault keeps the night");
    assert.equal(opened.drift, 0);
    assert.equal(pkg.muse.family, "athena");
    assert.equal(pkg.protocol, "sword-in-the-stone");

    const drifted = live.code.slice();
    drifted[2] = Math.min(7, drifted[2] + 1);
    const near = await returnSword(packageJson(pkg), "draw the sword", drifted);
    assert.equal(near.drift, 1);
  });

  it("keeps the sword in the stone for a far rhythm or the wrong phrase", async () => {
    const live = witness();
    const pkg = await drawSword({
      phrase: "draw the sword",
      witness: live,
      inner: textInner("sealed"),
      iterations: 1000,
    });
    const far = live.code.map((bin) => (bin + 3) % 8);
    await assert.rejects(() => returnSword(packageJson(pkg), "draw the sword", far), (error: unknown) => {
      assert.ok(error instanceof ZeusError);
      assert.equal(error.code, "stone");
      return true;
    });
    await assert.rejects(() => returnSword(packageJson(pkg), "another phrase", live.code), (error: unknown) => {
      assert.ok(error instanceof ZeusError);
      assert.equal(error.code, "stone");
      return true;
    });
  });

  it("CIS rejects a torn envelope and a swapped subject", async () => {
    const live = witness();
    const pkg = await drawSword({
      phrase: "draw the sword",
      witness: live,
      inner: fileInner("note.txt", "text/plain", new TextEncoder().encode("athena")),
      iterations: 1000,
    });
    const file = await returnSword(packageJson(pkg), "draw the sword", live.code);
    assert.equal(file.opened.t, "file");
    if (file.opened.t === "file") assert.equal(new TextDecoder().decode(file.opened.bytes), "athena");

    const torn = { ...pkg, ct: `${pkg.ct.slice(0, -4)}AAAA` };
    await assert.rejects(() => returnSword(JSON.stringify(torn), "draw the sword", live.code), (error: unknown) => {
      assert.ok(error instanceof ZeusError);
      assert.equal(error.code, "stone");
      return true;
    });

    const swapped = { ...pkg, subject: "someone-else" };
    await assert.rejects(() => returnSword(JSON.stringify(swapped), "draw the sword", live.code), (error: unknown) => {
      assert.ok(error instanceof ZeusError);
      assert.equal(error.code, "stone");
      return true;
    });

    assert.throws(() => readPackage("{"), (error: unknown) => error instanceof ZeusError && error.code === "envelope");
  });

  it("reseals the next CIS generation under the rhythm that drew it", async () => {
    const live = witness();
    const first = await drawSword({
      phrase: "draw the sword",
      witness: live,
      inner: textInner("lineage"),
      iterations: 1000,
    });
    const drifted = live.code.slice();
    drifted[0] = Math.min(7, drifted[0] + 1);
    const opened = await returnSword(packageJson(first), "draw the sword", drifted);
    const next = await drawSword({
      phrase: "draw the sword",
      witness: { ...live, code: drifted },
      inner: textInner(opened.opened.t === "text" ? opened.opened.body : ""),
      generation: first.generation + 1,
      parent: first.id,
      iterations: 1000,
    });
    assert.equal(next.generation, 2);
    assert.equal(next.parent, first.id);
    const again = await returnSword(packageJson(next), "draw the sword", drifted);
    assert.equal(again.pkg.cis, "cis-1");
    if (again.opened.t === "text") assert.equal(again.opened.body, "lineage");
  });
});

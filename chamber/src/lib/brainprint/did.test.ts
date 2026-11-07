import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DIMS } from "./engine.ts";
import {
  base58Decode,
  base58Encode,
  forgeDid,
  identityDrift,
  proofHolds,
  publicKeyBytes,
  unsealKey,
  vectorBins,
} from "./did.ts";
import { packageJson, type SwordWitness } from "./zeus.ts";

function witness(): SwordWitness {
  return {
    subject: "did:monarch:session",
    family: "athena",
    preset: "p1035",
    source: "bench",
    device: "Muse S Athena",
    code: [1, 2, 4, 1, 2, 1],
  };
}

describe("web5 did", () => {
  it("round-trips base58, including a leading zero", () => {
    const bytes = new Uint8Array([0, 237, 1, 9, 255]);
    assert.deepEqual(Array.from(base58Decode(base58Encode(bytes))), Array.from(bytes));
    assert.equal(base58Encode(new Uint8Array([0])), "1");
  });

  it("forges a unique SENTIUM document Sophia can verify", async () => {
    const live = witness();
    const vector = [0.2, 0.4, 0.5, 0.7, 0.3, 0.15];
    const first = await forgeDid({
      phrase: "draw the sword",
      witness: live,
      sci: 0.4128,
      leading: "self",
      vector,
      iterations: 1000,
      now: "2026-11-07T00:00:00.000Z",
    });
    const second = await forgeDid({
      phrase: "draw the sword",
      witness: live,
      sci: 0.4128,
      leading: "self",
      vector,
      iterations: 1000,
    });
    assert.notEqual(first.doc.id, second.doc.id);
    assert.ok(first.doc.id.startsWith("did:web5:z"));
    assert.equal(publicKeyBytes(first.doc.verificationMethod[0].publicKeyMultibase).length, 32);
    assert.equal(first.doc.sentium.ontology, "sentium-1");
    assert.equal(first.doc.sentium.sophia, "meta-observer");
    assert.equal(first.doc.sentium.muse.family, "athena");
    assert.deepEqual(first.doc.sentium.vector, vectorBins(vector));
    assert.equal(first.doc.sentium.vector.length, DIMS.length);
    assert.equal(await proofHolds(first.doc), true);

    const torn = structuredClone(first.doc);
    torn.sentium.sci = 0.9;
    assert.equal(await proofHolds(torn), false);

    const drift = identityDrift(first.doc, live.code.map((bin, index) => (index === 0 ? bin + 1 : bin)), vector);
    assert.equal(drift.rhythm, 1);
    assert.equal(drift.map, 0);
    const far = identityDrift(first.doc, live.code.map((bin) => (bin + 3) % 8), vector);
    assert.ok(far.rhythm > 2);

    await unsealKey(first.doc, packageJson(first.seal), "draw the sword", live.code);
  });

  it("seals the brainmap captured after the key stretch", async () => {
    const live = witness();
    const forged = await forgeDid({
      phrase: "draw the sword",
      witness: live,
      sci: 0.1,
      leading: "memory",
      vector: [0, 0, 0, 0, 0, 0],
      iterations: 1000,
      now: "2026-11-07T00:00:00.000Z",
      capture: () => ({
        witness: { ...live, code: [2, 2, 2, 2, 2, 2] },
        sci: 0.5,
        leading: "self",
        vector: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
      }),
    });
    assert.equal(forged.doc.sentium.leading, "self");
    assert.equal(forged.doc.sentium.sci, 0.5);
    assert.deepEqual(forged.doc.sentium.rhythm, [2, 2, 2, 2, 2, 2]);
    assert.deepEqual(forged.doc.sentium.vector, vectorBins([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]));
    assert.equal(forged.seal.subject, forged.doc.id);
    await unsealKey(forged.doc, packageJson(forged.seal), "draw the sword", [2, 2, 2, 2, 2, 2]);
  });
});

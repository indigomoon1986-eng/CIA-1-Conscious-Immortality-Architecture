import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { forgeDid } from "./did.ts";
import { bindGovId, govProofHolds, revokeGovId } from "./govid.ts";
import { ZeusError, type SwordWitness } from "./zeus.ts";

const NUMBER = "D1234567";

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

describe("gov id", () => {
  it("signs a card and drops the document number", async () => {
    const live = witness();
    const forged = await forgeDid({
      phrase: "draw the sword",
      witness: live,
      sci: 0.412,
      leading: "self",
      vector: [0.2, 0.4, 0.5, 0.7, 0.3, 0.15],
      iterations: 1000,
      now: "2026-11-07T00:00:00.000Z",
    });
    const cred = await bindGovId({
      doc: forged.doc,
      seal: forged.seal,
      phrase: "draw the sword",
      code: live.code,
      now: "2026-11-07T12:00:00.000Z",
      draft: {
        idType: "drivers_license",
        fullName: "Ada Stone",
        idNumber: NUMBER,
        dob: "1986-05-22",
        country: "US",
        state: "SC",
        expiry: "2030-01-01",
        faceHash: "face-mark",
        deviceHash: "device-mark",
      },
    });

    const dumped = JSON.stringify(cred);
    assert.equal(dumped.includes(NUMBER), false);
    assert.equal(dumped.includes("1986-05-22"), false);
    assert.equal(dumped.includes("face-mark"), false);
    assert.equal(cred.hint, "67");
    assert.equal(cred.strength, 3);
    assert.equal(cred.authority.includes("claimed"), true);
    assert.equal(cred.bindingLine.join(" ").includes(NUMBER), false);
    assert.equal(await govProofHolds(forged.doc, cred), true);

    const torn = structuredClone(cred);
    torn.fullName = "Other Name";
    assert.equal(await govProofHolds(forged.doc, torn), false);

    const revoked = await revokeGovId({
      doc: forged.doc,
      seal: forged.seal,
      phrase: "draw the sword",
      code: live.code,
      cred,
      now: "2026-11-07T13:00:00.000Z",
    });
    assert.equal(revoked.status, "revoked");
    assert.equal(JSON.stringify(revoked).includes(NUMBER), false);
    assert.notEqual(revoked.proof?.proofValue, cred.proof?.proofValue);
    assert.equal(await govProofHolds(forged.doc, revoked), true);
    assert.equal(await govProofHolds(forged.doc, cred), true);

    await assert.rejects(
      () =>
        bindGovId({
          doc: forged.doc,
          seal: forged.seal,
          phrase: "another drawing",
          code: live.code,
          draft: {
            idType: "passport",
            fullName: "Ada Stone",
            idNumber: "P998877",
            country: "US",
          },
        }),
      (error: unknown) => error instanceof ZeusError && error.code === "stone",
    );
  });
});

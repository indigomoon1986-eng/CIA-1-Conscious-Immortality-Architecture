/**
 * Local Web5 DID locked to a SENTIUM brainmap.
 *
 * The identifier is an Ed25519 key in did:web5 form. SENTIUM records the six
 * continuity axes, the Muse rhythm, and Sophia as meta-observer. CIS is the
 * signature on that document. The private key is not in the document: Zeus
 * seals it with the drawing phrase and the rhythm, so only a nearby montage
 * can open it.
 *
 * This browser keeps the document. It is not published to a DHT. A research
 * identity, not a legal one, and not a clinical reading.
 */

import { DIMS } from "./engine.ts";
import { drawSword, returnSword, rhythmDistance, type RhythmCode, type SwordWitness, type ZeusPackage } from "./zeus.ts";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ED25519_PREFIX = new Uint8Array([0xed, 0x01]);

export type IdentityMark = {
  did: string;
  held: boolean;
  turn: number;
};

export type SentiumOntology = {
  ontology: "sentium-1";
  subject: string;
  anchor: string;
  sci: number;
  leading: string;
  vector: number[];
  rhythm: number[];
  muse: { family: string; preset: string | null; source: string; device: string | null };
  sophia: "meta-observer";
};

export type Web5Did = {
  "@context": ["https://www.w3.org/ns/did/v1"];
  id: string;
  controller: string;
  verificationMethod: [
    {
      id: string;
      type: "Ed25519VerificationKey2020";
      controller: string;
      publicKeyMultibase: string;
    },
  ];
  authentication: [string];
  assertionMethod: [string];
  service: { id: string; type: string; serviceEndpoint: string }[];
  sentium: SentiumOntology;
  proof?: {
    type: "Ed25519Signature2020";
    created: string;
    verificationMethod: string;
    proofPurpose: "assertionMethod";
    proofValue: string;
  };
};

export class DidError extends Error {
  readonly code: "proof" | "rhythm" | "map" | "key";

  constructor(code: DidError["code"], message: string) {
    super(message);
    this.name = "DidError";
    this.code = code;
  }
}

export function vectorBins(vector: number[]): number[] {
  const bins = DIMS.map((_, index) => {
    const value = vector[index] ?? 0;
    return Math.max(0, Math.min(7, Math.floor(Math.max(0, value) * 8)));
  });
  return bins;
}

export function identityTurn(did: string): number {
  let hash = 0;
  for (let i = 0; i < did.length; i++) hash = (hash * 33 + did.charCodeAt(i)) >>> 0;
  return (hash % 1000) / 1000;
}

export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  const size = Math.ceil(bytes.length * 138 / 100) + 1;
  const digits = new Uint8Array(size);
  let length = 0;
  for (let i = zeroes; i < bytes.length; i++) {
    let carry = bytes[i];
    let j = 0;
    for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k -= 1, j += 1) {
      carry += 256 * digits[k];
      digits[k] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    length = j;
  }
  let it = size - length;
  while (it < size && digits[it] === 0) it += 1;
  let out = "1".repeat(zeroes);
  for (; it < size; it += 1) out += ALPHABET[digits[it]];
  return out;
}

export function base58Decode(text: string): Uint8Array {
  if (text.length === 0) return new Uint8Array();
  const bytes = [0];
  for (const char of text) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) throw new DidError("proof", "The multibase is not base58.");
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let zeroes = 0;
  for (const char of text) {
    if (char !== "1") break;
    zeroes += 1;
  }
  const body = bytes.reverse();
  while (body.length > 1 && body[0] === 0) body.shift();
  const out = new Uint8Array(zeroes + body.length);
  out.set(body, zeroes);
  return out;
}

function multibase(bytes: Uint8Array): string {
  return `z${base58Encode(bytes)}`;
}

function unmultibase(value: string): Uint8Array {
  if (!value.startsWith("z")) throw new DidError("proof", "The key is not a base58 multibase.");
  return base58Decode(value.slice(1));
}

export function publicKeyBytes(multibaseKey: string): Uint8Array {
  const raw = unmultibase(multibaseKey);
  if (raw.length !== ED25519_PREFIX.length + 32 || raw[0] !== 0xed || raw[1] !== 0x01) {
    throw new DidError("proof", "The verification key is not Ed25519.");
  }
  return raw.slice(2);
}

function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canon(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function unsigned(doc: Web5Did): string {
  const { proof: _proof, ...rest } = doc;
  return canon(rest);
}

async function importPublic(bytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", bytes as BufferSource, { name: "Ed25519" }, true, ["verify"]);
}

export async function proofHolds(doc: Web5Did): Promise<boolean> {
  if (!doc.proof || doc.proof.type !== "Ed25519Signature2020") return false;
  try {
    const key = await importPublic(publicKeyBytes(doc.verificationMethod[0].publicKeyMultibase));
    const sig = unmultibase(doc.proof.proofValue);
    return crypto.subtle.verify({ name: "Ed25519" }, key, sig as BufferSource, new TextEncoder().encode(unsigned(doc)) as BufferSource);
  } catch {
    return false;
  }
}

export function identityDrift(doc: Web5Did, code: RhythmCode, vector: number[]): { rhythm: number; map: number } {
  return {
    rhythm: rhythmDistance(doc.sentium.rhythm, code),
    map: rhythmDistance(doc.sentium.vector, vectorBins(vector)),
  };
}

export async function forgeDid(input: {
  phrase: string;
  witness: SwordWitness;
  sci: number;
  leading: string;
  vector: number[];
  iterations?: number;
  now?: string;
  /** Read after the key stretch, so the sealed map is the one Sophia is standing in. */
  capture?: (id: string) => { witness: SwordWitness; sci: number; leading: string; vector: number[] };
}): Promise<{ doc: Web5Did; seal: ZeusPackage }> {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const packed = new Uint8Array(ED25519_PREFIX.length + raw.length);
  packed.set(ED25519_PREFIX, 0);
  packed.set(raw, ED25519_PREFIX.length);
  const id = `did:web5:${multibase(packed)}`;
  const method = `${id}#key-1`;
  const created = input.now ?? new Date().toISOString();
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let witness: SwordWitness = { ...input.witness, subject: id };
  let reading = { sci: input.sci, leading: input.leading, vector: input.vector };
  const seal = await drawSword({
    phrase: input.phrase,
    witness,
    freshWitness: () => {
      const live = input.capture?.(id);
      if (live) {
        witness = { ...live.witness, subject: id };
        reading = { sci: live.sci, leading: live.leading, vector: live.vector };
      }
      return witness;
    },
    inner: { t: "text", body: bytesToB64(pkcs8) },
    iterations: input.iterations,
    now: created,
  });
  const doc: Web5Did = {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id,
    controller: id,
    verificationMethod: [
      {
        id: method,
        type: "Ed25519VerificationKey2020",
        controller: id,
        publicKeyMultibase: multibase(packed),
      },
    ],
    authentication: [method],
    assertionMethod: [method],
    service: [
      { id: `${id}#sophia`, type: "SophiaBrainmap", serviceEndpoint: "chamber:sophia" },
      { id: `${id}#zeus`, type: "ZeusGuardian", serviceEndpoint: "seal:sword-in-the-stone" },
      { id: `${id}#cis`, type: "CryptographicImmuneSystem", serviceEndpoint: "cis:cis-1" },
    ],
    sentium: {
      ontology: "sentium-1",
      subject: id,
      anchor: input.witness.subject,
      sci: Math.round(reading.sci * 1000) / 1000,
      leading: reading.leading,
      vector: vectorBins(reading.vector),
      rhythm: witness.code.slice(),
      muse: {
        family: witness.family,
        preset: witness.preset,
        source: witness.source,
        device: witness.device,
      },
      sophia: "meta-observer",
    },
  };
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(unsigned(doc)) as BufferSource),
  );
  doc.proof = {
    type: "Ed25519Signature2020",
    created,
    verificationMethod: method,
    proofPurpose: "assertionMethod",
    proofValue: multibase(signature),
  };
  return { doc, seal };
}

export async function unsealKey(doc: Web5Did, seal: string, phrase: string, code: RhythmCode): Promise<void> {
  const opened = await returnSword(seal, phrase, code);
  if (opened.opened.t !== "text") throw new DidError("key", "The sword did not return a key.");
  const pkcs8 = b64ToBytes(opened.opened.body);
  const privateKey = await crypto.subtle.importKey("pkcs8", pkcs8 as BufferSource, { name: "Ed25519" }, false, ["sign"]);
  const signed = new Uint8Array(
    await crypto.subtle.sign({ name: "Ed25519" }, privateKey, new TextEncoder().encode(unsigned(doc)) as BufferSource),
  );
  const publicKey = await importPublic(publicKeyBytes(doc.verificationMethod[0].publicKeyMultibase));
  const ok = await crypto.subtle.verify(
    { name: "Ed25519" },
    publicKey,
    signed as BufferSource,
    new TextEncoder().encode(unsigned(doc)) as BufferSource,
  );
  if (!ok) throw new DidError("key", "The sealed key does not belong to this DID.");
}

/** Sign a message with the sealed key. The key is not returned. */
export async function signWithSeal(doc: Web5Did, seal: string, phrase: string, code: RhythmCode, message: string): Promise<string> {
  const opened = await returnSword(seal, phrase, code);
  if (opened.opened.t !== "text") throw new DidError("key", "The sword did not return a key.");
  const pkcs8 = b64ToBytes(opened.opened.body);
  const privateKey = await crypto.subtle.importKey("pkcs8", pkcs8 as BufferSource, { name: "Ed25519" }, false, ["sign"]);
  const bytes = new TextEncoder().encode(message);
  const signed = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, bytes as BufferSource));
  const publicKey = await importPublic(publicKeyBytes(doc.verificationMethod[0].publicKeyMultibase));
  const ok = await crypto.subtle.verify({ name: "Ed25519" }, publicKey, signed as BufferSource, bytes as BufferSource);
  if (!ok) throw new DidError("key", "The sealed key does not belong to this DID.");
  return multibase(signed);
}

function bytesToB64(bytes: Uint8Array): string {
  let raw = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) raw += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(raw);
}

function b64ToBytes(value: string): Uint8Array {
  const raw = atob(value);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

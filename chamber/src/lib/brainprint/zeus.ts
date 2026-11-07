/**
 * Zeus Guardian seal.
 *
 * Sword in the Stone draws a package only when a drawing phrase and the live
 * rhythm agree. The rhythm is the six-band shape from the montage (Muse S
 * Athena, a bench, or the model). It is not stored in the package. A drift of
 * two bins can still draw; anything further stays in the stone.
 *
 * CIS (cryptographic immune system) binds the envelope as AES-GCM additional
 * data. A changed field or a torn ciphertext fails closed. Reseal mints the
 * next generation under the rhythm that just proved itself.
 *
 * Research seal. Not a bank vault and not a clinical reading.
 */

import { BANDS, type BandId } from "./engine.ts";
import type { EegSnapshot } from "./eeg.ts";

export const ZEUS_ITERATIONS = 120_000;
const CODE_LEN = BANDS.length;
const BIN = 8;
const DRIFT = 2;

export class ZeusError extends Error {
  readonly code: "phrase" | "empty" | "still" | "rhythm" | "envelope" | "stone";

  constructor(code: ZeusError["code"], message: string) {
    super(message);
    this.name = "ZeusError";
    this.code = code;
  }
}

export type RhythmCode = number[];

export type SwordWitness = {
  subject: string;
  family: string;
  preset: string | null;
  source: string;
  device: string | null;
  code: RhythmCode;
};

export type ZeusPackage = {
  v: 1;
  kind: "zeus-guardian";
  protocol: "sword-in-the-stone";
  cis: "cis-1";
  id: string;
  created: string;
  subject: string;
  muse: { family: string; preset: string | null; source: string; device: string | null };
  kdf: { name: "PBKDF2-SHA-256"; iterations: number; hash: "SHA-256" };
  aead: "AES-256-GCM";
  generation: number;
  parent: string | null;
  salt: string;
  iv: string;
  ct: string;
};

export type OpenedSeal =
  | { t: "text"; body: string }
  | { t: "file"; name: string; mime: string; bytes: Uint8Array };

type Inner = { t: "text"; body: string } | { t: "file"; name: string; mime: string; body: string };

export function rhythmFromBands(bandUv: Record<BandId, number>): RhythmCode {
  const values = BANDS.map((band) => Math.max(0, bandUv[band] ?? 0));
  const sum = values.reduce((total, value) => total + value, 0) || 1;
  return values.map((value) => Math.max(0, Math.min(BIN - 1, Math.floor((value / sum) * BIN))));
}

export function rhythmReady(snap: EegSnapshot | null): boolean {
  return !!snap && snap.liveLock != null && !snap.moving;
}

export function witnessFromSnap(snap: EegSnapshot, subject: string): SwordWitness {
  if (snap.moving) throw new ZeusError("still", "Hold still. A head turn is not part of the stone.");
  if (snap.liveLock == null) throw new ZeusError("rhythm", "The montage has not filled a full second yet.");
  const trimmed = subject.trim().slice(0, 80) || "did:monarch:session";
  return {
    subject: trimmed,
    family: snap.family,
    preset: snap.preset,
    source: snap.source,
    device: snap.deviceName,
    code: rhythmFromBands(snap.bandUv),
  };
}

export function rhythmDistance(a: RhythmCode, b: RhythmCode): number {
  let distance = 0;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) distance += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return distance;
}

/** Exact code first, then every code within the drift budget. */
export function nearCodes(code: RhythmCode, radius = DRIFT): RhythmCode[] {
  const out: RhythmCode[] = [];
  const walk = (index: number, left: number, acc: number[]) => {
    if (index === code.length) {
      out.push(acc.slice());
      return;
    }
    const base = code[index] ?? 0;
    for (let value = 0; value < BIN; value++) {
      const cost = Math.abs(value - base);
      if (cost > left) continue;
      acc.push(value);
      walk(index + 1, left - cost, acc);
      acc.pop();
    }
  };
  walk(0, radius, []);
  out.sort((a, b) => rhythmDistance(code, a) - rhythmDistance(code, b));
  return out;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToB64(bytes: Uint8Array): string {
  let raw = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    raw += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(raw);
}

function b64ToBytes(value: string): Uint8Array {
  const raw = atob(value);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function aadBytes(pkg: ZeusPackage): Uint8Array {
  return utf8(
    JSON.stringify({
      v: pkg.v,
      kind: pkg.kind,
      protocol: pkg.protocol,
      cis: pkg.cis,
      id: pkg.id,
      created: pkg.created,
      subject: pkg.subject,
      muse: pkg.muse,
      kdf: pkg.kdf,
      aead: pkg.aead,
      generation: pkg.generation,
      parent: pkg.parent,
      salt: pkg.salt,
      iv: pkg.iv,
    }),
  );
}

async function phraseKey(phrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", utf8(phrase) as BufferSource, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    base,
    256,
  );
  return crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
}

async function swordKey(phrase: CryptoKey, code: RhythmCode, salt: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: utf8(`sword:${code.join(".")}`) as BufferSource,
    },
    phrase,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function assertPhrase(phrase: string): void {
  if (phrase.trim().length < 8) {
    throw new ZeusError("phrase", "The drawing phrase needs at least 8 characters.");
  }
}

function packageShell(input: {
  witness: SwordWitness;
  generation: number;
  parent: string | null;
  iterations: number;
  created: string;
  salt: string;
  iv: string;
  ct: string;
}): ZeusPackage {
  return {
    v: 1,
    kind: "zeus-guardian",
    protocol: "sword-in-the-stone",
    cis: "cis-1",
    id: randomId(),
    created: input.created,
    subject: input.witness.subject,
    muse: {
      family: input.witness.family,
      preset: input.witness.preset,
      source: input.witness.source,
      device: input.witness.device,
    },
    kdf: { name: "PBKDF2-SHA-256", iterations: input.iterations, hash: "SHA-256" },
    aead: "AES-256-GCM",
    generation: input.generation,
    parent: input.parent,
    salt: input.salt,
    iv: input.iv,
    ct: input.ct,
  };
}

export async function drawSword(input: {
  phrase: string;
  witness: SwordWitness;
  inner: Inner;
  generation?: number;
  parent?: string | null;
  iterations?: number;
  now?: string;
  /** Called after the slow stretch, so the rhythm sealed is the one present now. */
  freshWitness?: () => SwordWitness;
}): Promise<ZeusPackage> {
  assertPhrase(input.phrase);
  if (input.witness.code.length !== CODE_LEN) throw new ZeusError("rhythm", "The rhythm code is incomplete.");
  const iterations = input.iterations ?? ZEUS_ITERATIONS;
  if (iterations < 1_000 || iterations > 200_000) throw new ZeusError("envelope", "The key stretch is outside the CIS range.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const phrase = await phraseKey(input.phrase, salt, iterations);
  const witness = input.freshWitness?.() ?? input.witness;
  if (witness.code.length !== CODE_LEN) throw new ZeusError("rhythm", "The rhythm code is incomplete.");
  const key = await swordKey(phrase, witness.code, salt);
  const shell = packageShell({
    witness,
    generation: input.generation ?? 1,
    parent: input.parent ?? null,
    iterations,
    created: input.now ?? new Date().toISOString(),
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    ct: "",
  });
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: aadBytes(shell) as BufferSource },
      key,
      utf8(JSON.stringify(input.inner)) as BufferSource,
    ),
  );
  return { ...shell, ct: bytesToB64(ct) };
}

export function readPackage(raw: string): ZeusPackage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ZeusError("envelope", "CIS could not read that envelope.");
  }
  if (!parsed || typeof parsed !== "object") throw new ZeusError("envelope", "CIS could not read that envelope.");
  const pkg = parsed as Partial<ZeusPackage>;
  const muse = pkg.muse;
  if (
    pkg.v !== 1 ||
    pkg.kind !== "zeus-guardian" ||
    pkg.protocol !== "sword-in-the-stone" ||
    pkg.cis !== "cis-1" ||
    pkg.aead !== "AES-256-GCM" ||
    typeof pkg.id !== "string" ||
    typeof pkg.created !== "string" ||
    typeof pkg.subject !== "string" ||
    !muse ||
    typeof muse.family !== "string" ||
    typeof muse.source !== "string" ||
    pkg.kdf?.name !== "PBKDF2-SHA-256" ||
    pkg.kdf.hash !== "SHA-256" ||
    typeof pkg.kdf.iterations !== "number" ||
    typeof pkg.generation !== "number" ||
    typeof pkg.salt !== "string" ||
    typeof pkg.iv !== "string" ||
    typeof pkg.ct !== "string"
  ) {
    throw new ZeusError("envelope", "CIS refused the envelope. It is not a Zeus Guardian seal.");
  }
  if (pkg.kdf.iterations < 1_000 || pkg.kdf.iterations > 200_000) {
    throw new ZeusError("envelope", "CIS refused the key stretch on this seal.");
  }
  return pkg as ZeusPackage;
}

function decodeInner(bytes: ArrayBuffer): OpenedSeal {
  let parsed: Inner;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes)) as Inner;
  } catch {
    throw new ZeusError("envelope", "The seal opened onto a torn payload.");
  }
  if (parsed.t === "text" && typeof parsed.body === "string") return { t: "text", body: parsed.body };
  if (parsed.t === "file" && typeof parsed.name === "string" && typeof parsed.body === "string") {
    return { t: "file", name: parsed.name, mime: parsed.mime || "application/octet-stream", bytes: b64ToBytes(parsed.body) };
  }
  throw new ZeusError("envelope", "The seal opened onto a payload CIS does not know.");
}

export async function returnSword(raw: string, phrase: string, code: RhythmCode): Promise<{ pkg: ZeusPackage; opened: OpenedSeal; drift: number }> {
  assertPhrase(phrase);
  const pkg = readPackage(raw);
  let salt: Uint8Array;
  let iv: Uint8Array;
  let ct: Uint8Array;
  try {
    salt = b64ToBytes(pkg.salt);
    iv = b64ToBytes(pkg.iv);
    ct = b64ToBytes(pkg.ct);
  } catch {
    throw new ZeusError("envelope", "CIS could not read the seal bytes.");
  }
  const phraseKeyMaterial = await phraseKey(phrase, salt, pkg.kdf.iterations);
  const aad = aadBytes(pkg);
  for (const candidate of nearCodes(code, DRIFT)) {
    try {
      const key = await swordKey(phraseKeyMaterial, candidate, salt);
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource },
        key,
        ct as BufferSource,
      );
      return { pkg, opened: decodeInner(plain), drift: rhythmDistance(code, candidate) };
    } catch (error) {
      if (error instanceof ZeusError) throw error;
    }
  }
  throw new ZeusError("stone", "The sword stayed in the stone. The phrase or the live rhythm does not match this seal.");
}

export function packageJson(pkg: ZeusPackage): string {
  return JSON.stringify(pkg, null, 2);
}

export function textInner(body: string): Inner {
  if (!body.trim()) throw new ZeusError("empty", "There is nothing to seal.");
  return { t: "text", body };
}

export function fileInner(name: string, mime: string, bytes: Uint8Array): Inner {
  if (bytes.byteLength === 0) throw new ZeusError("empty", "That file is empty.");
  if (bytes.byteLength > 192 * 1024) throw new ZeusError("empty", "CIS keeps a package under 192 KB.");
  return { t: "file", name: name.slice(0, 120) || "sealed.bin", mime: mime || "application/octet-stream", body: bytesToB64(bytes) };
}

/**
 * Self-issued government-ID binding for a Web5 name.
 *
 * The number is hashed on this machine and dropped. The sword signs the
 * binding. No DMV, passport office, or bank is contacted.
 */

import {
  base58Decode,
  publicKeyBytes,
  signWithSeal,
  type Web5Did,
} from "./did.ts";
import { packageJson, type RhythmCode, type ZeusPackage } from "./zeus.ts";

export const GOV_TYPES = [
  { id: "drivers_license", label: "Driver's license", authority: "State DMV, claimed" },
  { id: "real_id", label: "US Real ID", authority: "DHS / state DMV, claimed" },
  { id: "passport", label: "Passport", authority: "Foreign ministry, claimed" },
  { id: "national_id", label: "National ID", authority: "National registry, claimed" },
  { id: "monarchx_id", label: "MonarchX sovereign ID", authority: "MonarchX, self-issued" },
] as const;

export type GovIdType = (typeof GOV_TYPES)[number]["id"];

export type GovCredential = {
  v: 1;
  kind: "gov-id";
  id: string;
  subject: string;
  idType: GovIdType;
  authority: string;
  fullName: string;
  hint: string;
  country: string;
  state: string;
  expiry: string;
  idHash: string;
  monarchx: boolean;
  factors: { face: boolean; device: boolean; rhythm: boolean };
  strength: number;
  bindingLine: [string, string];
  status: "active" | "revoked";
  issued: string;
  proof?: {
    type: "Ed25519Signature2020";
    verificationMethod: string;
    proofPurpose: "assertionMethod";
    proofValue: string;
  };
};

export type GovDraft = {
  idType: GovIdType;
  fullName: string;
  idNumber: string;
  dob?: string;
  country: string;
  state?: string;
  expiry?: string;
  faceHash?: string | null;
  deviceHash?: string | null;
  monarchx?: boolean;
};

const PREFIX: Record<GovIdType, string> = {
  drivers_license: "DL",
  real_id: "RID",
  passport: "P",
  national_id: "NID",
  monarchx_id: "MXS",
};

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

function unsigned(cred: GovCredential): string {
  const { proof: _proof, ...rest } = cred;
  return canon(rest);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function typeOf(id: string): (typeof GOV_TYPES)[number] {
  return GOV_TYPES.find((item) => item.id === id) ?? GOV_TYPES[0];
}

export async function deviceMark(): Promise<string> {
  const fingerprint = [
    navigator.userAgent,
    screen.width,
    screen.height,
    screen.colorDepth,
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join("|");
  return sha256(fingerprint);
}

export async function hashCapture(dataUrl: string): Promise<string> {
  return sha256(dataUrl);
}

async function assemble(doc: Web5Did, draft: GovDraft, issued: string, status: GovCredential["status"]): Promise<GovCredential> {
  const kind = typeOf(draft.idType);
  const name = clip(draft.fullName, 80);
  const number = clip(draft.idNumber, 32);
  const country = clip(draft.country || "US", 3).toUpperCase() || "US";
  const state = clip(draft.state || "", 8).toUpperCase();
  const expiry = clip(draft.expiry || "", 10);
  const dob = clip(draft.dob || "", 10);
  if (name.length < 2) throw new Error("The card needs a name.");
  if (number.length < 4) throw new Error("The document number is too short to bind.");
  const idHash = await sha256(`${doc.id}|${kind.id}|${number}|${name}|${dob}|${country}`);
  const face = Boolean(draft.faceHash);
  const device = Boolean(draft.deviceHash);
  const rhythm = doc.sentium.rhythm.length === 6;
  const strength = [face, device, rhythm].filter(Boolean).length;
  const slug = name.toUpperCase().replace(/[^A-Z]/g, "<").slice(0, 20).padEnd(20, "<");
  const bindingLine: [string, string] = [
    `${PREFIX[kind.id]}<${country}<${slug}`,
    `${idHash.slice(0, 16)}<${(dob || "0000-00-00").replaceAll("-", "").slice(2)}<${(expiry || "0000-00-00").replaceAll("-", "").slice(2)}`,
  ];
  return {
    v: 1,
    kind: "gov-id",
    id: `gov-cred-${(await sha256(`${doc.id}:${idHash}`)).slice(0, 20)}`,
    subject: doc.id,
    idType: kind.id,
    authority: kind.authority,
    fullName: name,
    hint: number.slice(-2),
    country,
    state,
    expiry,
    idHash,
    monarchx: Boolean(draft.monarchx) || kind.id === "monarchx_id",
    factors: { face, device, rhythm },
    strength,
    bindingLine,
    status,
    issued,
  };
}

export async function bindGovId(input: {
  doc: Web5Did;
  seal: ZeusPackage;
  phrase: string;
  code: RhythmCode;
  draft: GovDraft;
  now?: string;
}): Promise<GovCredential> {
  const issued = input.now ?? new Date().toISOString();
  const cred = await assemble(input.doc, input.draft, issued, "active");
  const proofValue = await signWithSeal(input.doc, packageJson(input.seal), input.phrase, input.code, unsigned(cred));
  cred.proof = {
    type: "Ed25519Signature2020",
    verificationMethod: `${input.doc.id}#key-1`,
    proofPurpose: "assertionMethod",
    proofValue,
  };
  return cred;
}

export async function revokeGovId(input: {
  doc: Web5Did;
  seal: ZeusPackage;
  phrase: string;
  code: RhythmCode;
  cred: GovCredential;
  now?: string;
}): Promise<GovCredential> {
  const next: GovCredential = {
    ...input.cred,
    status: "revoked",
    issued: input.now ?? new Date().toISOString(),
    proof: undefined,
  };
  const proofValue = await signWithSeal(input.doc, packageJson(input.seal), input.phrase, input.code, unsigned(next));
  next.proof = {
    type: "Ed25519Signature2020",
    verificationMethod: `${input.doc.id}#key-1`,
    proofPurpose: "assertionMethod",
    proofValue,
  };
  return next;
}

export async function govProofHolds(doc: Web5Did, cred: GovCredential): Promise<boolean> {
  if (!cred.proof || cred.proof.type !== "Ed25519Signature2020") return false;
  if (cred.subject !== doc.id) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes(doc.verificationMethod[0].publicKeyMultibase) as BufferSource,
      { name: "Ed25519" },
      true,
      ["verify"],
    );
    const raw = cred.proof.proofValue.startsWith("z") ? cred.proof.proofValue.slice(1) : cred.proof.proofValue;
    const sig = base58Decode(raw);
    return crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      sig as BufferSource,
      new TextEncoder().encode(unsigned(cred)) as BufferSource,
    );
  } catch {
    return false;
  }
}

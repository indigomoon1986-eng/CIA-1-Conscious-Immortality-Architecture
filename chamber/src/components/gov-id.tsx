import { useEffect, useMemo, useState } from "react";
import { Ban, Camera, CreditCard, Crown, Shield } from "lucide-react";
import type { EegSnapshot } from "@/lib/brainprint/eeg";
import { DidError, type Web5Did } from "@/lib/brainprint/did";
import {
  GOV_TYPES,
  bindGovId,
  deviceMark,
  govProofHolds,
  hashCapture,
  revokeGovId,
  type GovCredential,
  type GovIdType,
} from "@/lib/brainprint/govid";
import { ZeusError, rhythmReady, witnessFromSnap, type ZeusPackage } from "@/lib/brainprint/zeus";

const STORE = "cia1-gov-ids";
const CAP = 5;
const STATES =
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
    " ",
  );

function loadFor(did: string): GovCredential[] {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, GovCredential[]>;
    const items = parsed[did];
    if (!Array.isArray(items)) return [];
    return items.filter((item) => item?.kind === "gov-id" && item.subject === did).slice(0, CAP);
  } catch {
    return [];
  }
}

function writeFor(did: string, items: GovCredential[]) {
  let archive: Record<string, GovCredential[]> = {};
  try {
    archive = JSON.parse(localStorage.getItem(STORE) || "{}") as Record<string, GovCredential[]>;
  } catch {
    archive = {};
  }
  archive[did] = items.slice(0, CAP);
  localStorage.setItem(STORE, JSON.stringify(archive));
}

function place(items: GovCredential[], next: GovCredential, replaceActive: boolean): GovCredential[] {
  const rest = items.filter((item) => {
    if (item.id === next.id) return false;
    if (replaceActive && item.idType === next.idType && item.status === "active") return false;
    return true;
  });
  return [next, ...rest].slice(0, CAP);
}

function labelFor(id: GovIdType): string {
  return GOV_TYPES.find((item) => item.id === id)?.label ?? id;
}

export function GovId({
  doc,
  seal,
  snap,
  consent,
  held,
}: {
  doc: Web5Did | null;
  seal: ZeusPackage | null;
  snap: EegSnapshot | null;
  consent: boolean;
  held: boolean;
}) {
  const [idType, setIdType] = useState<GovIdType>("drivers_license");
  const [fullName, setFullName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [dob, setDob] = useState("");
  const [country, setCountry] = useState("US");
  const [state, setState] = useState("SC");
  const [expiry, setExpiry] = useState("");
  const [monarchx, setMonarchx] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [faceHash, setFaceHash] = useState<string | null>(null);
  const [cards, setCards] = useState<GovCredential[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Forge a name first. A card binds to that name, not to an office.");

  useEffect(() => {
    if (!doc) {
      setCards([]);
      setStatus("Forge a name first. A card binds to that name, not to an office.");
      return;
    }
    const next = loadFor(doc.id);
    setCards(next);
    setStatus(next.length ? "Cards already bound to this name are on this node." : "No card on this name yet.");
  }, [doc]);

  const ready = rhythmReady(snap);
  const code = useMemo(() => {
    if (!doc || !snap || snap.liveLock == null || snap.moving) return null;
    try {
      return witnessFromSnap(snap, doc.id).code;
    } catch {
      return null;
    }
  }, [doc, snap]);

  const needsState = idType === "drivers_license" || idType === "real_id";
  const phraseOk = phrase.trim().length >= 8;
  const draftOk = fullName.trim().length >= 2 && idNumber.trim().length >= 4;
  const canSign = Boolean(consent && held && doc && seal && ready && code && phraseOk && !busy);
  const rhythm = doc?.sentium.rhythm.length === 6;
  const preview = [Boolean(faceHash), true, rhythm].filter(Boolean).length;

  async function takeFace() {
    if (busy) return;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      await new Promise<void>((resolve, reject) => {
        if (video.readyState >= 2) {
          resolve();
          return;
        }
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error("camera"));
      });
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 120;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("camera");
      ctx.drawImage(video, 0, 0, 160, 120);
      const hash = await hashCapture(canvas.toDataURL("image/jpeg", 0.7));
      setFaceHash(hash);
      setStatus("Face mark taken. The picture was discarded.");
    } catch {
      setFaceHash(null);
      setStatus("No camera. The card can still bind on this device and the sealed rhythm.");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }

  async function bind() {
    if (!doc || !seal || !code || !canSign || !draftOk) return;
    const number = idNumber;
    setBusy(true);
    setStatus("Opening the sword to sign the card. The number stays on this machine only for this moment.");
    try {
      const deviceHash = await deviceMark();
      const cred = await bindGovId({
        doc,
        seal,
        phrase: phrase.trim(),
        code,
        draft: {
          idType,
          fullName,
          idNumber: number,
          dob,
          country,
          state: needsState ? state : "",
          expiry,
          faceHash,
          deviceHash,
          monarchx: monarchx || idType === "monarchx_id",
        },
      });
      const next = place(loadFor(doc.id), cred, true);
      writeFor(doc.id, next);
      setCards(next);
      setIdNumber("");
      setStatus("Bound. The number was hashed and dropped. This card is self-issued.");
    } catch (error) {
      const message =
        error instanceof ZeusError || error instanceof DidError || error instanceof Error
          ? error.message
          : "The card could not be bound.";
      setStatus(message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(cred: GovCredential) {
    if (!doc || busy) return;
    setBusy(true);
    try {
      const ok = await govProofHolds(doc, cred);
      setStatus(ok ? "The public key on this name still signs that card." : "The signature on that card does not hold.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(cred: GovCredential) {
    if (!doc || !seal || !code || !canSign || cred.status === "revoked") return;
    setBusy(true);
    setStatus("Opening the sword to revoke the card.");
    try {
      const nextCred = await revokeGovId({ doc, seal, phrase: phrase.trim(), code, cred });
      const next = place(loadFor(doc.id), nextCred, false);
      writeFor(doc.id, next);
      setCards(next);
      setStatus("Revoked and signed again. The number was never stored.");
    } catch (error) {
      const message =
        error instanceof ZeusError || error instanceof DidError || error instanceof Error
          ? error.message
          : "The card stayed active.";
      setStatus(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-6xl px-4 pt-4" aria-label="Government ID">
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <h2 className="font-display text-2xl text-fg">Government ID</h2>
          <p className="text-xs tracking-widest text-brass uppercase">Self-issued · sword-signed</p>
        </div>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
          Bind a claimed document to this Web5 name. The number is hashed on this machine and dropped. Only the last two characters remain as a hint. Zeus signs the card with the sealed key. No DMV, passport office, or bank is contacted.
        </p>
        <p className="mt-3 text-sm text-fg">
          {held
            ? "The map is held, so the sword can sign."
            : "The map is not held. A card can be checked, but not signed, until this brainprint matches the seal."}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-muted" htmlFor="gov-type">
            Document
            <select
              id="gov-type"
              value={idType}
              onChange={(event) => setIdType(event.target.value as GovIdType)}
              className="mt-1 min-h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm text-fg"
            >
              {GOV_TYPES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-muted" htmlFor="gov-name">
            Name on the document
            <input
              id="gov-name"
              value={fullName}
              autoComplete="name"
              onChange={(event) => setFullName(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm text-fg"
            />
          </label>
          <label className="text-sm text-muted" htmlFor="gov-number">
            Document number
            <input
              id="gov-number"
              type="password"
              autoComplete="off"
              value={idNumber}
              onChange={(event) => setIdNumber(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm text-fg"
            />
          </label>
          <label className="text-sm text-muted" htmlFor="gov-dob">
            Date of birth
            <input
              id="gov-dob"
              type="date"
              value={dob}
              onChange={(event) => setDob(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm text-fg"
            />
          </label>
          <label className="text-sm text-muted" htmlFor="gov-country">
            Country
            <input
              id="gov-country"
              value={country}
              maxLength={3}
              onChange={(event) => setCountry(event.target.value.toUpperCase())}
              className="mt-1 min-h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm text-fg"
            />
          </label>
          {needsState ? (
            <label className="text-sm text-muted" htmlFor="gov-state">
              State
              <select
                id="gov-state"
                value={state}
                onChange={(event) => setState(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm text-fg"
              >
                {STATES.map((codeName) => (
                  <option key={codeName} value={codeName}>
                    {codeName}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="text-sm text-muted" htmlFor="gov-expiry">
              Expiry
              <input
                id="gov-expiry"
                type="date"
                value={expiry}
                onChange={(event) => setExpiry(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm text-fg"
              />
            </label>
          )}
          {needsState ? (
            <label className="text-sm text-muted sm:col-span-2" htmlFor="gov-expiry-state">
              Expiry
              <input
                id="gov-expiry-state"
                type="date"
                value={expiry}
                onChange={(event) => setExpiry(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm text-fg"
              />
            </label>
          ) : null}
        </div>

        <label className="mt-3 flex min-h-11 items-center gap-3 text-sm text-fg" htmlFor="gov-monarch">
          <input
            id="gov-monarch"
            type="checkbox"
            checked={monarchx || idType === "monarchx_id"}
            disabled={idType === "monarchx_id"}
            onChange={(event) => setMonarchx(event.target.checked)}
            className="size-5 accent-brass"
          />
          <Crown className="size-4 text-brass" aria-hidden="true" />
          Also mark this as a MonarchX credential
        </label>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={() => void takeFace()}
            disabled={busy}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-brass px-3 text-sm text-fg disabled:opacity-40"
          >
            <Camera className="size-4" aria-hidden="true" />
            {faceHash ? "Retake face mark" : "Take a face mark"}
          </button>
          {faceHash ? (
            <button
              type="button"
              onClick={() => {
                setFaceHash(null);
                setStatus("Face mark dropped. The picture was never kept.");
              }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm text-fg"
            >
              Drop face mark
            </button>
          ) : null}
        </div>
        <p className="mt-2 text-sm text-muted">
          {faceHash ? "A face mark is ready. The picture was discarded." : "No face mark. Binding can continue without one."} Preview strength {preview} of 3 — face, this device, and the sealed rhythm.
        </p>

        <label className="mt-4 block text-sm text-muted" htmlFor="gov-phrase">
          Drawing phrase
          <input
            id="gov-phrase"
            type="password"
            autoComplete="off"
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm text-fg"
          />
        </label>

        <button
          id="gov-bind"
          type="button"
          onClick={() => void bind()}
          disabled={!canSign || !draftOk}
          className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brass px-3 text-sm text-ink disabled:opacity-40"
        >
          <CreditCard className="size-4" aria-hidden="true" />
          {busy ? "Opening the sword…" : "Bind this card"}
        </button>

        <p className="mt-3 text-sm leading-relaxed text-fg" aria-live="polite">
          {status}
        </p>

        <ul className="mt-4 flex flex-col gap-3">
          {cards.map((cred) => (
            <li
              key={cred.id}
              className={
                cred.status === "active"
                  ? "rounded-2xl border border-brass bg-bg p-3"
                  : "rounded-2xl border border-border bg-bg p-3 opacity-80"
              }
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm text-fg">
                    {labelFor(cred.idType)} · {cred.fullName}
                    {cred.monarchx ? " · MonarchX" : ""}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    Hint ••{cred.hint} · {cred.country}
                    {cred.state ? ` ${cred.state}` : ""}
                    {cred.expiry ? ` · exp ${cred.expiry}` : ""} · {cred.status}
                  </p>
                  <p className="mt-1 text-xs text-muted">{cred.authority}</p>
                </div>
                <p className="flex items-center gap-2 text-xs tracking-widest text-brass uppercase">
                  <Shield className="size-3.5" aria-hidden="true" />
                  <span className="flex gap-1" aria-label={`Binding strength ${cred.strength} of 3`}>
                    {[0, 1, 2].map((pip) => (
                      <span
                        key={pip}
                        className={pip < cred.strength ? "size-2 rounded-full bg-teal" : "size-2 rounded-full bg-border"}
                      />
                    ))}
                  </span>
                  {cred.strength}/3
                </p>
              </div>
              <p className="mt-2 text-xs text-muted">
                {[
                  cred.factors.face ? "face" : null,
                  cred.factors.device ? "device" : null,
                  cred.factors.rhythm ? "rhythm" : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "no factors"}
              </p>
              <p className="mt-2 font-mono text-xs break-all text-fg">{cred.bindingLine[0]}</p>
              <p className="font-mono text-xs break-all text-muted">{cred.bindingLine[1]}</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void verify(cred)}
                  disabled={busy || !doc}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-brass px-3 text-sm text-fg disabled:opacity-40"
                >
                  <Shield className="size-4" aria-hidden="true" />
                  Verify
                </button>
                <button
                  type="button"
                  onClick={() => void revoke(cred)}
                  disabled={!canSign || cred.status === "revoked"}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm text-fg disabled:opacity-40"
                >
                  <Ban className="size-4" aria-hidden="true" />
                  Revoke
                </button>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-sm leading-relaxed text-muted">
          Self-issued only. Not a DMV card, not a passport, and not a bank link. Strength two or three means a later Monarch link could be offered. Nothing is linked from here, and the clone is not told about this card.
        </p>
      </div>
    </section>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Fingerprint, KeyRound } from "lucide-react";
import type { EegSnapshot } from "@/lib/brainprint/eeg";
import { DIMS, type DimId } from "@/lib/brainprint/engine";
import {
  DidError,
  forgeDid,
  identityDrift,
  identityTurn,
  proofHolds,
  unsealKey,
  type IdentityMark,
  type Web5Did,
} from "@/lib/brainprint/did";
import { ZeusError, packageJson, rhythmReady, witnessFromSnap, type SwordWitness, type ZeusPackage } from "@/lib/brainprint/zeus";

const STORE = "cia1-web5-did";

const AXIS: Record<DimId, string> = {
  causal: "Causal",
  memory: "Memory",
  behavior: "Behavior",
  self: "Self",
  topology: "Topology",
  embodiment: "Embodiment",
};

type Stored = { doc: Web5Did; seal: ZeusPackage };

function shortDid(id: string): string {
  if (id.length < 28) return id;
  return `${id.slice(0, 18)}…${id.slice(-8)}`;
}

function loadStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (!parsed?.doc?.id?.startsWith("did:web5:")) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function SovereignDid({
  snap,
  consent,
  subject,
  sci,
  leading,
  vector,
  capture,
  onMark,
  onDoc,
  onSeal,
  onSubject,
}: {
  snap: EegSnapshot | null;
  consent: boolean;
  subject: string;
  sci: number;
  leading: string;
  vector: number[];
  capture: (id: string) => { witness: SwordWitness; sci: number; leading: string; vector: number[] };
  onMark: (mark: IdentityMark | null) => void;
  onDoc: (doc: Web5Did | null) => void;
  onSeal: (seal: ZeusPackage | null) => void;
  onSubject: (subject: string) => void;
}) {
  const [phrase, setPhrase] = useState("");
  const [doc, setDoc] = useState<Web5Did | null>(null);
  const [seal, setSeal] = useState<ZeusPackage | null>(null);
  const [proof, setProof] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    "No identity yet. A drawing phrase and this brainmap can forge one Sophia will hold.",
  );

  useEffect(() => {
    const stored = loadStored();
    if (!stored) return;
    setDoc(stored.doc);
    setSeal(stored.seal);
    onSubject(stored.doc.id);
    setStatus("A Web5 document from this browser is loaded. The private key stays inside its sword seal.");
  }, [onSubject]);

  useEffect(() => {
    onDoc(doc);
  }, [doc, onDoc]);

  useEffect(() => {
    onSeal(seal);
  }, [seal, onSeal]);

  useEffect(() => {
    if (!doc) {
      setProof(false);
      return;
    }
    let live = true;
    void proofHolds(doc).then((ok) => {
      if (live) setProof(ok);
    });
    return () => {
      live = false;
    };
  }, [doc]);

  const ready = rhythmReady(snap);
  const code = useMemo(() => {
    if (!snap || snap.liveLock == null || snap.moving) return null;
    try {
      return witnessFromSnap(snap, subject).code;
    } catch {
      return null;
    }
  }, [snap, subject]);

  const drift = doc && code ? identityDrift(doc, code, vector) : null;
  const held = Boolean(proof && drift && drift.rhythm <= 2 && drift.map <= 2);

  useEffect(() => {
    if (!doc) {
      onMark(null);
      return;
    }
    onMark({ did: doc.id, held, turn: identityTurn(doc.id) });
  }, [doc, held, onMark]);

  function remember(nextDoc: Web5Did, nextSeal: ZeusPackage) {
    setDoc(nextDoc);
    setSeal(nextSeal);
    localStorage.setItem(STORE, JSON.stringify({ doc: nextDoc, seal: nextSeal }));
    onSubject(nextDoc.id);
  }

  async function forge() {
    if (!snap || !consent || busy) return;
    setBusy(true);
    try {
      const forged = await forgeDid({
        phrase,
        witness: witnessFromSnap(snap, subject),
        sci,
        leading,
        vector,
        capture,
      });
      remember(forged.doc, forged.seal);
      setStatus("Forged. Sophia is the meta-observer. The private key is sealed in the sword and is not on the document.");
    } catch (error) {
      const message = error instanceof ZeusError || error instanceof DidError ? error.message : "The identity could not be forged.";
      setStatus(message);
    } finally {
      setBusy(false);
    }
  }

  async function unseal() {
    if (!doc || !seal || !code || busy) return;
    setBusy(true);
    try {
      await unsealKey(doc, packageJson(seal), phrase, code);
      setStatus("The sealed key signed this document again. It was checked, then dropped. It is not shown.");
    } catch (error) {
      const message = error instanceof ZeusError || error instanceof DidError ? error.message : "The key stayed sealed.";
      setStatus(message);
    } finally {
      setBusy(false);
    }
  }

  function downloadDoc() {
    if (!doc) return;
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "cia1-web5-did.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  const phraseOk = phrase.trim().length >= 8;
  const holdLine = !doc
    ? "The chamber has no identity ring yet."
    : !proof
      ? "The signature on this document does not hold."
      : !code || !drift
        ? "Waiting for a still, full second before the hold can be read."
        : held
          ? "Held. This brainmap still matches the identity Sophia is watching."
          : drift.rhythm > 2 && drift.map > 2
            ? "The rhythm and the six-axis map have both left the seal."
            : drift.rhythm > 2
              ? "The live rhythm has left the seal."
              : "The brainmap has left the seal.";

  return (
    <section className="mx-auto max-w-6xl px-4 pt-4" aria-label="Sovereign identity">
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <h2 className="font-display text-2xl text-fg">Sovereign identity</h2>
          <p className="text-xs tracking-widest text-brass uppercase">Web5 · SENTIUM · Sophia</p>
        </div>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
          One Ed25519 name, forged here and nowhere else. SENTIUM writes the six continuity axes and the Muse rhythm into the document. Zeus seals the private key to that rhythm. CIS is the signature. Sophia holds the name in the chamber only while this brainmap still matches.
        </p>

        <p className="mt-3 break-all text-sm text-fg" aria-live="polite">
          {doc ? shortDid(doc.id) : "did:web5: — not forged"}
        </p>
        <p className="mt-1 text-sm text-fg">{holdLine}</p>

        {doc ? (
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="SENTIUM axes on the identity">
            {DIMS.map((dim, index) => (
              <div key={dim}>
                <p className="mb-1 text-xs tracking-widest text-muted uppercase">{AXIS[dim]}</p>
                <div className="flex h-10 items-end rounded-lg bg-bg px-1">
                  <div
                    className={held ? "w-full rounded-sm bg-teal" : "w-full rounded-sm bg-brass"}
                    style={{ height: `${(((doc.sentium.vector[index] ?? 0) + 1) / 8) * 100}%` }}
                  />
                </div>
                <p className="mt-1 tabular-nums text-xs text-muted">{doc.sentium.vector[index] ?? 0}</p>
              </div>
            ))}
          </div>
        ) : null}

        {doc ? (
          <p className="mt-3 text-sm text-muted">
            SCI {doc.sentium.sci.toFixed(3)} · leading {doc.sentium.leading} ·{" "}
            {doc.sentium.muse.family === "none"
              ? "model rhythm"
              : doc.sentium.muse.family === "athena"
                ? "Muse S Athena"
                : doc.sentium.muse.family}
            {doc.sentium.muse.preset ? ` ${doc.sentium.muse.preset}` : ""} · Sophia {doc.sentium.sophia}
            {drift ? ` · rhythm drift ${drift.rhythm} · map drift ${drift.map}` : ""}
          </p>
        ) : null}

        <label className="mt-4 block text-sm text-muted" htmlFor="did-phrase">
          Drawing phrase
          <input
            id="did-phrase"
            type="password"
            autoComplete="off"
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm text-fg"
          />
        </label>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={() => void forge()}
            disabled={!consent || !ready || busy || !phraseOk}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brass px-3 text-sm text-ink disabled:opacity-40"
          >
            <Fingerprint className="size-4" aria-hidden="true" />
            {busy ? "Working…" : doc ? "Forge another" : "Forge identity"}
          </button>
          <button
            type="button"
            onClick={() => void unseal()}
            disabled={!consent || !ready || busy || !phraseOk || !doc || !seal}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-brass px-3 text-sm text-fg disabled:opacity-40"
          >
            <KeyRound className="size-4" aria-hidden="true" />
            Unseal key
          </button>
          <button
            type="button"
            onClick={downloadDoc}
            disabled={!doc}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm text-fg disabled:opacity-40"
          >
            Download document
          </button>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-fg" aria-live="polite">
          {status}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Not published to a network. Not a legal identity. Not a clinical reading. A different phrase cannot open the key. A nearby rhythm can.
        </p>
      </div>
    </section>
  );
}

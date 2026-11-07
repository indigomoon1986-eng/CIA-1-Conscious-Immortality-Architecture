import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ShieldCheck, Sword } from "lucide-react";
import type { EegSnapshot } from "@/lib/brainprint/eeg";
import { BANDS } from "@/lib/brainprint/engine";
import {
  ZeusError,
  drawSword,
  fileInner,
  packageJson,
  returnSword,
  rhythmReady,
  textInner,
  witnessFromSnap,
  type OpenedSeal,
  type ZeusPackage,
} from "@/lib/brainprint/zeus";

const ARCHIVE = "cia1-zeus-seals";
const FILE_CAP = 192 * 1024;

type HeldFile = { name: string; mime: string; bytes: Uint8Array };

function museLabel(snap: EegSnapshot | null): string {
  if (!snap || snap.source === "model") return "Model rhythm";
  if (snap.family === "athena") return snap.deviceName ?? "Muse S Athena";
  if (snap.source === "bench") return "Muse bench";
  return snap.deviceName ?? "Muse";
}

function loadArchive(): ZeusPackage[] {
  try {
    const raw = localStorage.getItem(ARCHIVE);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ZeusPackage[];
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function asBlob(bytes: Uint8Array, type: string): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type });
}

function saveArchive(packages: ZeusPackage[]) {
  localStorage.setItem(ARCHIVE, JSON.stringify(packages.slice(0, 8)));
}

export function ZeusVault({
  snap,
  consent,
  subject,
  reduceMotion,
}: {
  snap: EegSnapshot | null;
  consent: boolean;
  subject: string;
  reduceMotion: boolean;
}) {
  const [phrase, setPhrase] = useState("");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<HeldFile | null>(null);
  const [envelope, setEnvelope] = useState("");
  const [opened, setOpened] = useState<OpenedSeal | null>(null);
  const [generation, setGeneration] = useState<number | null>(null);
  const [status, setStatus] = useState("The sword is in the stone. A Muse rhythm and a drawing phrase can pull it.");
  const [busy, setBusy] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [archive, setArchive] = useState<ZeusPackage[]>([]);

  useEffect(() => {
    setArchive(loadArchive());
  }, []);

  const ready = rhythmReady(snap);
  const code = useMemo(() => {
    if (!snap || snap.liveLock == null) return null;
    try {
      return witnessFromSnap(snap, subject).code;
    } catch {
      return null;
    }
  }, [snap, subject]);

  function remember(pkg: ZeusPackage) {
    const next = [pkg, ...archive.filter((item) => item.id !== pkg.id)].slice(0, 8);
    setArchive(next);
    saveArchive(next);
    setEnvelope(packageJson(pkg));
    setGeneration(pkg.generation);
  }

  async function draw(reseal = false) {
    if (!snap || !consent || busy) return;
    setBusy(true);
    setOpened(null);
    try {
      const witness = witnessFromSnap(snap, subject);
      const inner =
        reseal && opened
          ? opened.t === "text"
            ? textInner(opened.body)
            : fileInner(opened.name, opened.mime, opened.bytes)
          : file
            ? fileInner(file.name, file.mime, file.bytes)
            : textInner(body);
      let parent: string | null = null;
      let gen = 1;
      if (reseal && envelope.trim()) {
        const prior = JSON.parse(envelope) as ZeusPackage;
        parent = prior.id ?? null;
        gen = (prior.generation ?? 1) + 1;
      }
      const pkg = await drawSword({ phrase, witness, inner, generation: gen, parent });
      remember(pkg);
      setDrawn(true);
      setStatus(
        reseal
          ? `CIS resealed generation ${pkg.generation}. The new stone is this rhythm, parent ${parent?.slice(0, 8) ?? "none"}.`
          : `Sword drawn. Zeus sealed generation 1 on ${museLabel(snap)}${snap.preset ? ` · ${snap.preset}` : ""}.`,
      );
    } catch (error) {
      setDrawn(false);
      setStatus(error instanceof ZeusError ? error.message : "The seal did not close.");
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!snap || !consent || busy) return;
    setBusy(true);
    try {
      const witness = witnessFromSnap(snap, subject);
      const result = await returnSword(envelope, phrase, witness.code);
      setOpened(result.opened);
      setGeneration(result.pkg.generation);
      setDrawn(true);
      const drift = result.drift === 0 ? "The rhythm matched the stone." : `The rhythm was ${result.drift} bin${result.drift === 1 ? "" : "s"} off, still close enough.`;
      setStatus(`Sword returned. ${drift} CIS accepted generation ${result.pkg.generation}.`);
    } catch (error) {
      setDrawn(false);
      setOpened(null);
      setStatus(error instanceof ZeusError ? error.message : "The seal did not open.");
    } finally {
      setBusy(false);
    }
  }

  function downloadPackage() {
    if (!envelope.trim()) return;
    const blob = new Blob([envelope], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `zeus-guardian-${generation ?? 1}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadOpened() {
    if (!opened || opened.t !== "file") return;
    const blob = asBlob(opened.bytes, opened.mime);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = opened.name;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(next: File | null) {
    if (!next) {
      setFile(null);
      return;
    }
    if (next.size > FILE_CAP) {
      setFile(null);
      setStatus("CIS keeps a package under 192 KB.");
      return;
    }
    const bytes = new Uint8Array(await next.arrayBuffer());
    setFile({ name: next.name, mime: next.type || "application/octet-stream", bytes });
    setStatus(`${next.name} is waiting in the stone. The drawing phrase still has to match on the way out.`);
  }

  const lift = drawn && !reduceMotion ? "-translate-y-4" : drawn ? "-translate-y-3" : "";

  return (
    <section className="mx-auto max-w-6xl px-4 pt-4" aria-label="Zeus Guardian">
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="grid gap-4 md:grid-cols-[7rem_1fr] md:items-start">
          <div className="relative mx-auto h-36 w-16" aria-hidden="true">
            <div className={`absolute inset-x-4 top-0 h-16 rounded-t-full bg-brass transition-transform duration-200 ${lift}`} />
            <div className={`absolute inset-x-5 top-14 h-4 bg-brass transition-transform duration-200 ${lift}`} />
            <div className="absolute inset-x-0 bottom-0 h-12 rounded-xl border border-border bg-raised" />
          </div>
          <div>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <h2 className="font-display text-2xl text-fg">Zeus Guardian</h2>
              <p className="text-xs tracking-widest text-brass uppercase">
                Sword in the Stone · CIS
                {snap?.preset ? ` · ${snap.preset}` : ""}
              </p>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
              The package is AES-256-GCM. The key is your drawing phrase stretched with the live six-band rhythm, then thrown away.
              Muse S Athena, the Athena bench, or the signal bench can hold the stone. CIS binds the envelope, so a swapped field will not open.
            </p>
            <p className="mt-2 text-sm text-fg">
              {museLabel(snap)}
              {snap?.family === "athena" ? " · four electrodes, 730/850 nm witnessed" : ""}
              {ready ? " · rhythm in the stone" : snap?.moving ? " · hold still" : " · waiting for a full second"}
            </p>
            <div className="mt-3 grid grid-cols-6 gap-2" aria-label="Live rhythm in the stone">
              {BANDS.map((band, index) => (
                <div key={band}>
                  <p className="mb-1 text-xs tracking-widest text-muted uppercase">{band}</p>
                  <div className="flex h-10 items-end rounded-lg bg-bg px-1">
                    <div
                      className={index < 3 ? "w-full rounded-sm bg-brass" : "w-full rounded-sm bg-teal"}
                      style={{ height: `${(((code?.[index] ?? 0) + 1) / 8) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-muted" htmlFor="drawing-phrase">
            Drawing phrase
            <input
              id="drawing-phrase"
              type="password"
              autoComplete="off"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm text-fg"
            />
          </label>
          <label className="block text-sm text-muted" htmlFor="zeus-file">
            File in the package
            <input
              id="zeus-file"
              type="file"
              onChange={(event) => void onFile(event.target.files?.[0] ?? null)}
              className="mt-1 block min-h-11 w-full text-sm text-fg file:mr-3 file:min-h-11 file:rounded-xl file:border-0 file:bg-raised file:px-3 file:text-sm file:text-fg"
            />
          </label>
        </div>
        <label className="mt-3 block text-sm text-muted" htmlFor="zeus-body">
          Words in the package
          <textarea
            id="zeus-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            placeholder={file ? `${file.name} will be sealed instead of these words.` : "A note only this rhythm should read."}
            className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
          />
        </label>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={() => void draw(false)}
            disabled={!consent || !ready || busy}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brass px-3 text-sm text-ink disabled:opacity-40"
          >
            <Sword className="size-4" aria-hidden="true" />
            {busy ? "Working…" : "Draw the sword"}
          </button>
          <button
            type="button"
            onClick={() => void restore()}
            disabled={!consent || !ready || busy || !envelope.trim()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-brass px-3 text-sm text-fg disabled:opacity-40"
          >
            <ShieldCheck className="size-4" aria-hidden="true" />
            Return the sword
          </button>
          <button
            type="button"
            onClick={() => void draw(true)}
            disabled={!consent || !ready || busy || !opened}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm text-fg disabled:opacity-40"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            CIS reseal
          </button>
          <button
            type="button"
            onClick={downloadPackage}
            disabled={!envelope.trim()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm text-fg disabled:opacity-40"
          >
            Download package
          </button>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-fg" aria-live="polite">
          {status}
        </p>
        {opened?.t === "text" ? (
          <p className="mt-2 rounded-xl border border-border bg-bg px-3 py-2 text-sm leading-relaxed text-fg">{opened.body}</p>
        ) : null}
        {opened?.t === "file" ? (
          <button
            type="button"
            onClick={downloadOpened}
            className="mt-2 inline-flex min-h-11 items-center text-sm text-brass"
          >
            Save {opened.name}
          </button>
        ) : null}

        <label className="mt-3 block text-sm text-muted" htmlFor="zeus-envelope">
          Package
          <textarea
            id="zeus-envelope"
            value={envelope}
            onChange={(event) => setEnvelope(event.target.value)}
            rows={5}
            spellCheck={false}
            className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
          />
        </label>

        {archive.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2" aria-label="Seals kept in this browser">
            {archive.map((pkg) => (
              <li key={pkg.id}>
                <button
                  type="button"
                  onClick={() => {
                    setEnvelope(packageJson(pkg));
                    setGeneration(pkg.generation);
                    setStatus(`Generation ${pkg.generation} is in the editor. Return the sword with the same phrase and a close rhythm.`);
                  }}
                  className="flex min-h-11 w-full items-baseline justify-between gap-3 rounded-xl border border-border bg-bg px-3 py-2 text-left"
                >
                  <span className="text-sm text-fg">
                    {pkg.muse.family === "athena" ? "Muse S Athena" : pkg.muse.source} · gen {pkg.generation}
                  </span>
                  <span className="text-sm text-muted">{pkg.id.slice(0, 8)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="mt-3 text-sm leading-relaxed text-muted">
          The rhythm is not written into the package. A nearby shape can still draw the sword. A different phrase cannot.
          Nothing is sent off this browser. This is a research seal, not a clinical device and not a bank.
        </p>
      </div>
    </section>
  );
}

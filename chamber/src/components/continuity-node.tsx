import { useEffect, useState } from "react";
import { MessagesSquare, Orbit, Server, Volume2 } from "lucide-react";
import { speakWithClone, type CloneTurn } from "@/lib/brainprint/clone";
import type { Web5Did } from "@/lib/brainprint/did";

const CAP = 16;

type StoredTurn = CloneTurn & { at: string };

function vaultKey(did: string): string {
  return `cia1-toroidal-vault:${did}`;
}

function loadVault(did: string): StoredTurn[] {
  try {
    const raw = localStorage.getItem(vaultKey(did));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredTurn[];
    return Array.isArray(parsed) ? parsed.slice(-CAP) : [];
  } catch {
    return [];
  }
}

function saveVault(did: string, turns: StoredTurn[]) {
  localStorage.setItem(vaultKey(did), JSON.stringify(turns.slice(-CAP)));
}

function hear(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 0.96;
  window.speechSynthesis.speak(utter);
}

export function ContinuityNode({
  doc,
  held,
  consent,
  onMemories,
}: {
  doc: Web5Did | null;
  held: boolean;
  consent: boolean;
  onMemories: (count: number) => void;
}) {
  const [line, setLine] = useState("");
  const [turns, setTurns] = useState<StoredTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Forge a name and hold the map. Then the print can speak.");

  useEffect(() => {
    if (!doc) {
      setTurns([]);
      onMemories(0);
      setStatus("Forge a name and hold the map. Then the print can speak.");
      return;
    }
    const next = loadVault(doc.id);
    setTurns(next);
    onMemories(next.length);
    setStatus(
      held
        ? "The print is in the room. What you say stays in the vault on this node."
        : "The map has left the seal. The print will not speak until it matches again.",
    );
  }, [doc, held, onMemories]);

  async function speak() {
    if (!doc || !held || !consent || busy) return;
    const text = line.trim();
    if (!text) return;
    setBusy(true);
    setStatus("The print is listening.");
    try {
      const history: CloneTurn[] = turns.slice(-6).map(({ role, text: body }) => ({ role, text: body }));
      const result = await speakWithClone({
        data: {
          line: text,
          history,
          print: {
            did: doc.id,
            held: true,
            sci: doc.sentium.sci,
            leading: doc.sentium.leading,
            vector: doc.sentium.vector,
            rhythm: doc.sentium.rhythm,
            muse: doc.sentium.muse.family === "none" ? "model" : doc.sentium.muse.family,
            anchor: doc.sentium.anchor,
          },
        },
      });
      if (!result.ok) {
        setStatus(result.error);
        setBusy(false);
        return;
      }
      const next = [
        ...turns,
        { role: "user" as const, text, at: new Date().toISOString() },
        { role: "clone" as const, text: result.text, at: new Date().toISOString() },
      ].slice(-CAP);
      setTurns(next);
      saveVault(doc.id, next);
      onMemories(next.length);
      setLine("");
      setStatus("Answered. The line is on the vault ring.");
    } catch {
      setStatus("The clone could not answer just now.");
    }
    setBusy(false);
  }

  function forget() {
    if (!doc) return;
    localStorage.removeItem(vaultKey(doc.id));
    setTurns([]);
    onMemories(0);
    setStatus("This node's vault for that name is empty.");
  }

  const lastClone = [...turns].reverse().find((turn) => turn.role === "clone");

  return (
    <section className="mx-auto max-w-6xl px-4 pt-4" aria-label="Sovereign node">
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <h2 className="font-display text-2xl text-fg">Sovereign node</h2>
          <p className="text-xs tracking-widest text-brass uppercase">Vault · clone · this browser</p>
        </div>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
          This browser is the node. The sword keeps the key. The Web5 name is the door. The vault is a ring of
          what you and the print have said. Nothing here is a network, a clinic, or a copy of a soul.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-3">
          <li className="rounded-xl border border-border bg-bg px-3 py-2">
            <p className="flex items-center gap-2 text-xs tracking-widest text-muted uppercase">
              <Server className="size-3.5 text-brass" aria-hidden="true" />
              Node
            </p>
            <p className="mt-1 text-sm text-fg">Local. No mesh peers.</p>
          </li>
          <li className="rounded-xl border border-border bg-bg px-3 py-2">
            <p className="flex items-center gap-2 text-xs tracking-widest text-muted uppercase">
              <Orbit className="size-3.5 text-brass" aria-hidden="true" />
              Vault
            </p>
            <p className="mt-1 text-sm text-fg">{turns.length} lines on the ring</p>
          </li>
          <li className="rounded-xl border border-border bg-bg px-3 py-2">
            <p className="flex items-center gap-2 text-xs tracking-widest text-muted uppercase">
              <MessagesSquare className="size-3.5 text-brass" aria-hidden="true" />
              Print
            </p>
            <p className="mt-1 text-sm text-fg">{doc && held ? "Standing across from Sophia" : "Not in the room"}</p>
          </li>
        </ul>

        <label className="mt-4 block text-sm text-muted" htmlFor="clone-line">
          Speak to the print
          <textarea
            id="clone-line"
            value={line}
            onChange={(event) => setLine(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder={held ? "Ask the sealed print, not the person." : "Hold the map before you speak."}
            className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
          />
        </label>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={() => void speak()}
            disabled={!consent || !held || busy || !line.trim()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brass px-3 text-sm text-ink disabled:opacity-40"
          >
            <MessagesSquare className="size-4" aria-hidden="true" />
            {busy ? "Listening…" : "Speak"}
          </button>
          <button
            type="button"
            onClick={() => lastClone && hear(lastClone.text)}
            disabled={!lastClone}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-brass px-3 text-sm text-fg disabled:opacity-40"
          >
            <Volume2 className="size-4" aria-hidden="true" />
            Hear the last line
          </button>
          <button
            type="button"
            onClick={forget}
            disabled={!doc || turns.length === 0}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm text-fg disabled:opacity-40"
          >
            Empty this vault
          </button>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-fg" aria-live="polite">
          {status}
        </p>
        {turns.length > 0 ? (
          <ol className="mt-3 flex max-h-64 flex-col gap-2 overflow-auto" aria-label="Toroidal vault">
            {turns.map((turn, index) => (
              <li
                key={`${turn.at}-${index}`}
                className="rounded-xl border border-border bg-bg px-3 py-2 text-sm leading-relaxed text-fg"
              >
                <span className="text-xs tracking-widest text-brass uppercase">
                  {turn.role === "clone" ? "Print" : "You"}
                </span>
                <p className="mt-1">{turn.text}</p>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </section>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Headphones, Lock, Play, ShieldCheck, Square, Unlock } from "lucide-react";
import { ChamberHost } from "@/components/chamber-host";
import { EegSync } from "@/components/eeg-sync";
import { SovereignDid } from "@/components/sovereign-did";
import { ZeusVault } from "@/components/zeus-vault";
import {
  DIMS,
  PROTOCOLS,
  computeFrame,
  protocolById,
  sha256Hex,
  type AudioMode,
  type DimId,
  type Frame,
  type PinMode,
} from "@/lib/brainprint/engine";
import { EntrainmentAudio } from "@/lib/brainprint/audio";
import {
  ENVIRONMENT_LABEL,
  lockTarget,
  readResonance,
  slewBeat,
} from "@/lib/brainprint/resonance";
import type { EegSnapshot } from "@/lib/brainprint/eeg";
import type { IdentityMark } from "@/lib/brainprint/did";
import { witnessFromSnap } from "@/lib/brainprint/zeus";

const DIM_LABEL: Record<DimId, string> = {
  causal: "Causal",
  memory: "Memory",
  behavior: "Behavior",
  self: "Self",
  topology: "Topology",
  embodiment: "Embodiment",
};

const OUTWARD = new Set(["smr", "beta", "gamma"]);

type SavedPrint = {
  id: string;
  subject: string;
  protocol: string;
  sci: number;
  mode: string;
  rho: number;
  lock: number;
  leading: string;
  anchor: string;
  vector: number[];
  elapsed: number;
};

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

function Scalp({ frame, pulse }: { frame: Frame; pulse: number }) {
  const byId = new Map(frame.shards.map((site) => [site.id, site]));
  return (
    <svg viewBox="0 0 200 228" className="w-full" role="img" aria-label="Ten-twenty cognitive map">
      <ellipse cx="100" cy="116" rx="72" ry="88" fill="var(--color-raised)" stroke="var(--color-border)" />
      <path d="M100 20 L91 34 L109 34 Z" fill="var(--color-border)" />
      <path d="M24 116 Q32 98 40 116 Q32 134 24 116" fill="var(--color-border)" />
      <path d="M176 116 Q168 98 160 116 Q168 134 176 116" fill="var(--color-border)" />
      {frame.entangled.map(([a, b]) => {
        const left = byId.get(a);
        const right = byId.get(b);
        if (!left || !right) return null;
        return (
          <line
            key={`${a}-${b}`}
            x1={left.svgX}
            y1={left.svgY}
            x2={right.svgX}
            y2={right.svgY}
            stroke="var(--color-teal)"
            strokeOpacity="0.7"
          />
        );
      })}
      {frame.shards.map((site) => {
        const outward = OUTWARD.has(site.dominant);
        const color = outward ? "var(--color-teal)" : "var(--color-brass)";
        const radius = 6 + site.amp * 9;
        const locus = frame.locus === site.id;
        return (
          <g key={site.id}>
            {locus ? (
              <circle
                cx={site.svgX}
                cy={site.svgY}
                r={radius + 5}
                fill="none"
                stroke="var(--color-brass)"
                strokeOpacity={pulse}
              />
            ) : null}
            <circle
              cx={site.svgX}
              cy={site.svgY}
              r={radius}
              fill={color}
              fillOpacity={0.3 + site.amp * 0.6}
              stroke={color}
            />
            <text
              x={site.svgX}
              y={site.svgY + radius + 9}
              textAnchor="middle"
              fill="var(--color-fg)"
              fontSize="8"
            >
              {site.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function AxisRows({ frame }: { frame: Frame }) {
  return (
    <ul className="flex flex-col gap-2">
      {DIMS.map((dim, index) => {
        const value = frame.vector[index];
        const outward = dim === "causal" || dim === "behavior" || dim === "topology";
        return (
          <li key={dim}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className={frame.leading === dim ? "text-fg" : "text-muted"}>{DIM_LABEL[dim]}</span>
              <span className="tabular-nums text-fg">{value.toFixed(2)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-raised">
              <div
                className={outward ? "h-full bg-teal" : "h-full bg-brass"}
                style={{ width: `${Math.round(value * 100)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function BrainLab() {
  const audioRef = useRef(new EntrainmentAudio());
  const startRef = useRef(0);
  const historyRef = useRef<number[][]>([]);
  const lastSecondRef = useRef(-1);
  const [subject, setSubject] = useState("did:monarch:session");
  const [protocolId, setProtocolId] = useState("baseline");
  const [beat, setBeat] = useState(10);
  const [carrier, setCarrier] = useState(180);
  const [mode, setMode] = useState<AudioMode>("binaural");
  const [pin, setPin] = useState<PinMode>("auto");
  const [volume, setVolume] = useState(35);
  const [consent, setConsent] = useState(false);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState<number[][]>([]);
  const [status, setStatus] = useState("Resting signature. No tone yet.");
  const [anchor, setAnchor] = useState("");
  const [prints, setPrints] = useState<SavedPrint[]>([]);
  const [ready, setReady] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [lockOn, setLockOn] = useState(false);
  const [syncOn, setSyncOn] = useState(false);
  const [eeg, setEeg] = useState<EegSnapshot | null>(null);
  const [greet, setGreet] = useState<string | null>(null);
  const [mark, setMark] = useState<IdentityMark | null>(null);

  const paramsRef = useRef({ subject, protocolId, beat, pin, lockOn });
  paramsRef.current = { subject, protocolId, beat, pin, lockOn };
  const eegRef = useRef<EegSnapshot | null>(null);
  eegRef.current = eeg;
  const captureRef = useRef({ protocolId, elapsed, beat, pin, history, eeg });
  captureRef.current = { protocolId, elapsed, beat, pin, history, eeg };
  const captureMap = useCallback((id: string) => {
    const now = captureRef.current;
    if (!now.eeg) throw new Error("The montage is not live.");
    const next = computeFrame({
      subject: id,
      protocolId: now.protocolId,
      elapsed: now.elapsed,
      beat: now.beat,
      pin: now.pin,
      history: now.history,
      measured: now.eeg.sites,
      liveLock: now.eeg.liveLock,
    });
    return {
      witness: witnessFromSnap(now.eeg, id),
      sci: next.sci,
      leading: next.leading,
      vector: next.vector,
    };
  }, []);
  const prevBandsRef = useRef<[number, number, number, number] | null>(null);
  const greetTimer = useRef(0);

  const frame = useMemo(
    () =>
      computeFrame({
        subject,
        protocolId,
        elapsed,
        beat,
        pin,
        history,
        measured: eeg?.sites ?? null,
        liveLock: eeg?.liveLock ?? null,
      }),
    [subject, protocolId, elapsed, beat, pin, history, eeg],
  );
  const resonance = useMemo(
    () => readResonance(frame, prevBandsRef.current, consent, beat),
    [frame, consent, beat],
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(media.matches);
    try {
      const raw = localStorage.getItem("cia1-brainprints");
      if (raw) setPrints(JSON.parse(raw) as SavedPrint[]);
    } catch {
      /* ignore a bad archive */
    }
    setReady(true);
    return () => {
      audioRef.current.stop();
      window.clearTimeout(greetTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!consent) setSyncOn(false);
  }, [consent]);

  useEffect(() => {
    prevBandsRef.current = [frame.bands.alpha, frame.bands.beta, frame.bands.theta, frame.bands.gamma];
  }, [frame]);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem("cia1-brainprints", JSON.stringify(prints));
  }, [prints, ready]);

  useEffect(() => {
    let cancel = false;
    void sha256Hex(frame.anchorInput).then((hex) => {
      if (!cancel) setAnchor(hex);
    });
    return () => {
      cancel = true;
    };
  }, [frame.anchorInput]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const nowElapsed = (performance.now() - startRef.current) / 1000;
      const second = Math.floor(nowElapsed);
      if (second !== lastSecondRef.current) {
        const live = eegRef.current;
        const sample = computeFrame({
          ...paramsRef.current,
          elapsed: nowElapsed,
          history: historyRef.current,
          measured: live?.sites ?? null,
          liveLock: live?.liveLock ?? null,
        });
        const next = [...historyRef.current, sample.vector].slice(-60);
        historyRef.current = next;
        lastSecondRef.current = second;
        setHistory(next);
      }
      if (paramsRef.current.lockOn) {
        const live = eegRef.current;
        const sample = computeFrame({
          ...paramsRef.current,
          elapsed: nowElapsed,
          history: historyRef.current,
          measured: live?.sites ?? null,
          liveLock: live?.liveLock ?? null,
        });
        const reading = readResonance(sample, prevBandsRef.current, true, paramsRef.current.beat);
        const nextBeat = slewBeat(paramsRef.current.beat, lockTarget(reading.dominant, reading.action));
        if (nextBeat !== paramsRef.current.beat) setBeat(nextBeat);
      }
      setElapsed(nowElapsed);
    }, 200);
    return () => window.clearInterval(id);
  }, [running]);

  const duck = running && resonance.action === "SAFETY_PAUSE" ? 0.15 : 1;
  const trim = syncOn && running && resonance.action !== "SAFETY_PAUSE" ? (eeg?.trimHz ?? 0) : 0;
  const audioBeat = Math.min(40, Math.max(0.4, beat + trim));

  useEffect(() => {
    if (!running) return;
    audioRef.current.update({ carrier, beat: audioBeat, mode, volume: volume / 100, duck });
  }, [running, carrier, audioBeat, mode, volume, duck]);

  useEffect(() => {
    if (!running) return;
    if (resonance.action === "SAFETY_PAUSE") {
      setStatus("Safety pause. The tone is ducked. Withdraw, or choose a quieter protocol.");
      return;
    }
    if (!audioRef.current.running) {
      setStatus("This browser blocked the tone. The map still runs without audio.");
      return;
    }
    setStatus(
      syncOn && eeg?.locked
        ? "Entraining. EEG sync is holding the tone on the measured rhythm."
        : lockOn
          ? "Entraining. Resonance lock is holding the beat on the leading band."
          : "Entraining. Headphones on. Withdraw whenever you want.",
    );
  }, [running, resonance.action, lockOn, syncOn, eeg?.locked]);

  const protocol = protocolById(protocolId);
  const pulse = reduceMotion || !running ? 0.85 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(elapsed * beat * Math.PI * 2));

  async function begin() {
    if (!consent || running) return;
    historyRef.current = [];
    lastSecondRef.current = -1;
    startRef.current = performance.now();
    setHistory([]);
    setElapsed(0);
    setStatus("Entraining. Headphones on. Withdraw whenever you want.");
    try {
      await audioRef.current.start({ carrier, beat, mode, volume: volume / 100 });
      setRunning(true);
    } catch {
      setStatus("This browser blocked the tone. The map still runs without audio.");
      setRunning(true);
    }
  }

  function withdraw() {
    audioRef.current.stop();
    setRunning(false);
    setStatus("Participation withdrawn. The tone is released. The last map stays.");
  }

  function toggleLock() {
    if (!consent) return;
    setLockOn((value) => !value);
  }

  function greetSophia() {
    setGreet("I mirror this print. I do not become it.");
    window.clearTimeout(greetTimer.current);
    greetTimer.current = window.setTimeout(() => setGreet(null), 4200);
  }

  const spoken =
    resonance.action === "SAFETY_PAUSE" && consent ? resonance.spoken : (greet ?? resonance.spoken);
  const beatLabel = Number.isInteger(beat) ? String(beat) : beat.toFixed(1);

  function chooseProtocol(id: string) {
    const next = protocolById(id);
    setProtocolId(next.id);
    setBeat(next.beat);
    setMode(next.audio);
  }

  async function freeze() {
    if (!anchor) return;
    const print: SavedPrint = {
      id: `${Date.now()}`,
      subject: frame.subject,
      protocol: frame.title,
      sci: frame.sci,
      mode: frame.mode,
      rho: frame.rho,
      lock: frame.lock,
      leading: frame.leading,
      anchor,
      vector: frame.vector,
      elapsed: frame.elapsed,
    };
    setPrints((prev) => [print, ...prev].slice(0, 8));
  }

  function download() {
    const record = {
      ...frame,
      resonance: {
        status: resonance.status,
        label: resonance.label,
        phrase: resonance.phrase,
        action: resonance.action,
        dominant: resonance.dominant,
        targetHz: resonance.targetHz,
        lockError: resonance.lockError,
        quality: resonance.quality,
        environment: resonance.environment,
        focus: resonance.focus,
        calm: resonance.calm,
        overload: resonance.overload,
        curvature: resonance.curvature,
      },
      anchor: anchor ? `sha256:${anchor}` : null,
      disclaimer:
        eeg?.source === "muse"
          ? "Muse montage projected onto ten sites. Functional continuity indicator only. Not a diagnosis."
          : eeg?.source === "bench"
            ? "Signal bench through the Muse decoders. Functional continuity indicator only. Not a live subject."
            : "Functional continuity indicator only. Model EEG stream, not proof of subjective identity.",
      eeg: eeg
        ? {
            source: eeg.source,
            device: eeg.deviceName,
            family: eeg.family,
            preset: eeg.preset,
            firmware: eeg.firmware,
            battery: eeg.battery,
            heartBpm: eeg.heartBpm,
            moving: eeg.moving,
            channels: eeg.channels,
            peakHz: eeg.peakHz,
            quality: eeg.quality,
            locked: eeg.locked,
            phaseErrorDeg: eeg.phaseErrorDeg,
            trimHz: eeg.trimHz,
            bandUv: eeg.bandUv,
          }
        : null,
    };
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cia1-brainprint-${(anchor || "frame").slice(0, 8)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const stateLabel = running ? (syncOn && eeg?.locked ? "Synced" : "Live") : elapsed > 0 ? "Held" : "Resting";

  return (
    <main className="min-h-screen bg-bg text-fg">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-5">
          <p className="text-xs tracking-widest text-brass uppercase">Monarch · Sentium · CIA-1</p>
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div className="max-w-xl">
              <h1 className="font-display text-4xl leading-tight text-fg">Brainprint</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Entrain a rhythm and watch it become a cognitive map. Sophia stands in the chamber as a
                meta-observer of that map. A Muse headset, or the signal bench, drives that map from a live
                montage. The same rhythm can draw the sword: Zeus Guardian seals a package to it. Forge a
                Web5 name and Sophia holds it only while this brainmap still matches.
              </p>
            </div>
            <p className="text-sm text-muted">
              {stateLabel} · {clock(elapsed)} · depth {frame.depth.toFixed(2)}
              {eeg?.heartBpm != null ? ` · ${Math.round(eeg.heartBpm)} bpm` : ""}
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pt-4">
        <section className="relative h-96 overflow-hidden rounded-2xl border border-border bg-bg md:h-chamber" aria-label="Immersive chamber">
          <ChamberHost
            frame={frame}
            history={history}
            resonance={resonance}
            lockOn={lockOn && consent}
            reduceMotion={reduceMotion}
            mark={mark}
            onGreet={greetSophia}
          />
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
            <div className="pointer-events-auto max-w-[16rem] rounded-xl border border-border bg-surface/90 px-3 py-2">
              <p className="text-xs tracking-widest text-brass uppercase">{resonance.role}</p>
              <p className="text-sm text-fg">{ENVIRONMENT_LABEL[resonance.environment]}</p>
              <p className="text-sm text-muted">
                {resonance.sceneMode} · {resonance.label.replaceAll("_", " ")}
              </p>
            </div>
            <div className="pointer-events-auto rounded-xl border border-border bg-surface/90 px-3 py-2 text-right">
              <p className="text-xs tracking-widest text-muted uppercase">
                {lockOn ? "Locked" : "Open"} · {resonance.dominant}
              </p>
              <p className="tabular-nums text-sm text-fg">
                {resonance.targetHz} Hz · error {resonance.lockError.toFixed(1)}
              </p>
              <p className="tabular-nums text-sm text-muted">quality {resonance.quality.toFixed(2)}</p>
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3">
            <div className="pointer-events-auto flex flex-col gap-2 rounded-xl border border-border bg-surface/90 px-3 py-2 md:flex-row md:items-center md:justify-between">
              <p className="text-sm leading-relaxed text-fg" aria-live="polite">
                {spoken}
              </p>
              <button
                type="button"
                onClick={toggleLock}
                disabled={!consent}
                aria-pressed={lockOn}
                className={
                  lockOn
                    ? "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-teal px-3 text-sm text-ink"
                    : "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-brass px-3 text-sm text-fg disabled:opacity-40"
                }
              >
                {lockOn ? <Lock className="size-4" aria-hidden="true" /> : <Unlock className="size-4" aria-hidden="true" />}
                {lockOn ? "Resonance locked" : "Resonance lock"}
              </button>
            </div>
          </div>
        </section>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Drag to orbit. Scroll or pinch to zoom. Tap Sophia.
          {mark
            ? mark.held
              ? ` Sophia is locked to ${mark.did.slice(0, 18)}…${mark.did.slice(-6)}.`
              : ` Sophia is watching ${mark.did.slice(0, 18)}…${mark.did.slice(-6)}. This brainmap has left the seal.`
            : " The trace under the map is the live montage, not a decoration."}
        </p>
      </div>

      <EegSync
        drive={{
          subject,
          protocolId,
          elapsed,
          beat,
          running,
          sync: syncOn,
          paused: running && resonance.action === "SAFETY_PAUSE",
        }}
        consent={consent}
        reduceMotion={reduceMotion}
        onSnapshot={setEeg}
        onSync={setSyncOn}
      />

      <ZeusVault snap={eeg} consent={consent} subject={subject} reduceMotion={reduceMotion} />

      <SovereignDid
        snap={eeg}
        consent={consent}
        subject={subject}
        sci={frame.sci}
        leading={frame.leading}
        vector={frame.vector}
        capture={captureMap}
        onMark={setMark}
        onSubject={setSubject}
      />

      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-4 lg:grid-cols-12">
        <section className="flex flex-col gap-4 lg:col-span-4" aria-label="Entrainment">
          <div className="rounded-2xl border border-border bg-surface p-4">
            <label className="flex min-h-11 items-start gap-3" htmlFor="consent">
              <input
                id="consent"
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="mt-1 size-5 accent-brass"
              />
              <span className="text-sm leading-relaxed text-fg">
                I am an adult giving informed consent for a synthetic research session. I can withdraw at any
                moment. This is not medical care, and it does not authorize any migration claim.
              </span>
            </label>
            <p className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-muted">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brass" aria-hidden="true" />
              Stop if you feel unwell. Not for anyone with a history of seizures. Not a diagnosis.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-4">
            <label className="text-xs tracking-widest text-muted uppercase" htmlFor="subject">
              Subject anchor
            </label>
            <input
              id="subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              spellCheck={false}
              className="mt-2 min-h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm text-fg"
            />
            <p className="mt-2 text-sm text-muted">The same name always grows the same resting print.</p>
          </div>

          <div className="flex flex-col gap-2">
            {PROTOCOLS.map((item) => {
              const selected = item.id === protocolId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => chooseProtocol(item.id)}
                  className={
                    selected
                      ? "min-h-11 rounded-xl border border-brass bg-raised px-3 py-2 text-left"
                      : "min-h-11 rounded-xl border border-border bg-surface px-3 py-2 text-left"
                  }
                  aria-pressed={selected}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-fg">{item.title}</span>
                    <span className="text-xs tabular-nums text-brass">{item.beat} Hz</span>
                  </span>
                  <span className="mt-1 block text-sm leading-relaxed text-muted">{item.summary}</span>
                </button>
              );
            })}
          </div>

          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="grid grid-cols-3 gap-2">
              {(["binaural", "monaural", "isochronic"] as AudioMode[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setMode(item)}
                  aria-pressed={mode === item}
                  className={
                    mode === item
                      ? "min-h-11 rounded-xl border border-brass bg-raised px-2 text-sm text-fg capitalize"
                      : "min-h-11 rounded-xl border border-border px-2 text-sm text-muted capitalize"
                  }
                >
                  {item}
                </button>
              ))}
            </div>
            <p className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-muted">
              <Headphones className="mt-0.5 size-4 shrink-0 text-teal" aria-hidden="true" />
              Binaural needs headphones. Each ear hears a different carrier. The beat is the difference.
            </p>
            <label className="mt-4 block text-xs tracking-widest text-muted uppercase" htmlFor="carrier">
              Carrier {carrier} Hz
            </label>
            <input
              id="carrier"
              type="range"
              min={120}
              max={220}
              value={carrier}
              onChange={(event) => setCarrier(Number(event.target.value))}
              className="mt-2 h-11 w-full accent-brass"
            />
            <label className="mt-2 block text-xs tracking-widest text-muted uppercase" htmlFor="beat">
              Beat {beatLabel} Hz
              {lockOn ? ` · target ${resonance.targetHz}` : ""}
            </label>
            <input
              id="beat"
              type="range"
              min={1}
              max={40}
              step={0.1}
              value={beat}
              disabled={lockOn}
              onChange={(event) => setBeat(Number(event.target.value))}
              className="mt-2 h-11 w-full accent-brass disabled:opacity-40"
            />
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {lockOn
                ? running
                  ? "Lock is slewing the beat onto the leading band. A safety pause parks it at 10 Hz and ducks the tone. The protocol field keeps integrating until you withdraw."
                  : "Lock is armed. Begin the session and the beat will move onto the leading band."
                : "Leave the beat free, or lock it to whichever band is leading the print."}
            </p>
            <label className="mt-2 block text-xs tracking-widest text-muted uppercase" htmlFor="volume">
              Level {volume}
            </label>
            <input
              id="volume"
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
              className="mt-2 h-11 w-full accent-brass"
            />
            <p className="mt-4 text-xs tracking-widest text-muted uppercase">Mind pin</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(["auto", "focus", "absorb"] as PinMode[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setPin(item)}
                  aria-pressed={pin === item}
                  className={
                    pin === item
                      ? "min-h-11 rounded-xl border border-teal bg-raised text-sm text-fg capitalize"
                      : "min-h-11 rounded-xl border border-border text-sm text-muted capitalize"
                  }
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {running ? (
                <button
                  type="button"
                  onClick={withdraw}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brass px-3 text-sm text-ink"
                >
                  <Square className="size-4" aria-hidden="true" />
                  Withdraw
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void begin()}
                  disabled={!consent}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brass px-3 text-sm text-ink disabled:opacity-40"
                >
                  <Play className="size-4" aria-hidden="true" />
                  Begin
                </button>
              )}
              <button
                type="button"
                onClick={() => void freeze()}
                className="min-h-11 rounded-xl border border-border px-3 text-sm text-fg"
              >
                Freeze print
              </button>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted">{status}</p>
          </div>
        </section>

        <section className="lg:col-span-5" aria-label="Cognitive map">
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-2xl text-fg">Cognitive map</h2>
              <p className="text-xs tracking-widest text-muted uppercase">{protocol.phase.replaceAll("_", " ")}</p>
            </div>
            <Scalp frame={frame} pulse={pulse} />
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              <span>Brass holds delta through alpha.</span>
              <span>Teal holds SMR through gamma.</span>
              <span>Lines are toroidal neighbors.</span>
            </div>
            <p className="mt-3 text-sm text-fg">
              Locus {frame.locus ?? "scattered"} · {frame.entangled.length} entangled pairs · H0 {frame.h0}
            </p>
            <svg viewBox="0 0 120 32" className="mt-3 h-8 w-full" aria-label="Live montage, two seconds">
              <path
                d={(eeg?.spark.length ? eeg.spark : [0]).map((value, i, all) => {
                  const x = (i / Math.max(1, all.length - 1)) * 120;
                  const y = 16 - value * 12;
                  return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
                }).join(" ")}
                fill="none"
                stroke="var(--color-brass)"
                strokeWidth="1.5"
              />
            </svg>
          </div>

          <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-2xl text-fg">Held prints</h2>
              <button type="button" onClick={download} className="inline-flex min-h-11 items-center gap-2 text-sm text-brass">
                <Download className="size-4" aria-hidden="true" />
                Download frame
              </button>
            </div>
            {prints.length === 0 ? (
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Freeze a frame to keep a brainprint in this browser. Nothing is sent anywhere.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {prints.map((print) => (
                  <li key={print.id} className="rounded-xl border border-border bg-bg px-3 py-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm text-fg">{print.protocol}</span>
                      <span className="tabular-nums text-sm text-brass">SCI {print.sci.toFixed(3)}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {print.subject} · {print.mode} · {print.leading} · {print.anchor.slice(0, 12)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-4 lg:col-span-3" aria-label="Continuity">
          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-xs tracking-widest text-muted uppercase">Subjective continuity index</p>
            <p className="font-display text-5xl tabular-nums text-brass">{frame.sci.toFixed(3)}</p>
            <p className="mt-1 text-sm text-muted">
              {frame.lower.toFixed(2)} – {frame.upper.toFixed(2)} · leading {DIM_LABEL[frame.leading]}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Equal-weight mean of six functional axes. A higher score is not a person continuing.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-4">
            <h2 className="font-display text-2xl text-fg">Continuity vector</h2>
            <div className="mt-3">
              <AxisRows frame={frame} />
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-2xl text-fg">Mind</h2>
              <span
                className={
                  frame.mode === "focus"
                    ? "rounded-full border border-teal px-3 py-1 text-xs tracking-widest text-teal uppercase"
                    : "rounded-full border border-brass px-3 py-1 text-xs tracking-widest text-brass uppercase"
                }
              >
                {frame.mode}
                {frame.pinned ? " · pinned" : ""}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted">Coherence ρ</dt>
                <dd className="tabular-nums text-fg">{frame.rho.toFixed(3)}</dd>
              </div>
              <div>
                <dt className="text-muted">Carrier lock</dt>
                <dd className="tabular-nums text-fg">{frame.lock.toFixed(2)}</dd>
              </div>
              <div>
                <dt className="text-muted">Focus</dt>
                <dd className="tabular-nums text-fg">{resonance.focus.toFixed(2)}</dd>
              </div>
              <div>
                <dt className="text-muted">Calm</dt>
                <dd className="tabular-nums text-fg">{resonance.calm.toFixed(2)}</dd>
              </div>
              <div>
                <dt className="text-muted">Overload</dt>
                <dd className="tabular-nums text-fg">{resonance.overload.toFixed(2)}</dd>
              </div>
              <div>
                <dt className="text-muted">Curvature</dt>
                <dd className="tabular-nums text-fg">{resonance.curvature.toFixed(3)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs tracking-widest text-muted uppercase">Ξ tensor</p>
            <div className="mt-2 grid grid-cols-6 gap-1" aria-hidden="true">
              {frame.tensor.flat().map((value, index) => (
                <div
                  key={index}
                  className="h-6 rounded-sm"
                  style={{
                    background: `color-mix(in oklab, var(--color-brass) ${Math.round(value * 100)}%, var(--color-raised))`,
                  }}
                  title={value.toFixed(3)}
                />
              ))}
            </div>
            <p className="mt-2 text-sm text-muted">Frobenius {frame.frobenius.toFixed(3)}</p>
            <p className="mt-3 text-sm leading-relaxed break-all text-muted" title={anchor}>
              {anchor ? `sha256:${anchor.slice(0, 24)}` : "anchoring…"}
            </p>
          </div>
        </section>
      </div>

      <footer className="mx-auto max-w-6xl px-4 pb-8 text-sm leading-relaxed text-muted">
        Coherence and tone recovery are ported from veritash-experimental. The decoder, the chamber directive,
        and the safety pause are the bounded formulas from Sophia’s MR7 reference. EEG sync measures a live
        montage — model or Muse — and phase-locks the tone to it. SCI and the tensor are CIA-1. Reason,
        rhythm, responsibility. Witness the map. It is a model of the signal, not the singer.
      </footer>
    </main>
  );
}

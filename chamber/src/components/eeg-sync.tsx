import { useEffect, useRef, useState } from "react";
import { Activity, Bluetooth, BluetoothOff, HeartPulse, Radio } from "lucide-react";
import { BANDS, type BandId } from "@/lib/brainprint/engine";
import { LiveEeg, type EegDrive, type EegSnapshot } from "@/lib/brainprint/eeg";

const BAND_LABEL: Record<BandId, string> = {
  delta: "δ",
  theta: "θ",
  alpha: "α",
  smr: "smr",
  beta: "β",
  gamma: "γ",
};

function paint(canvas: HTMLCanvasElement, traces: { id: string; samples: Float32Array }[]) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width < 2 || height < 2) return;
  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const style = getComputedStyle(canvas);
  const fg = style.getPropertyValue("--color-fg").trim() || "#ebe6d8";
  const brass = style.getPropertyValue("--color-brass").trim() || "#c6a15a";
  const teal = style.getPropertyValue("--color-teal").trim() || "#4ea394";
  const grid = style.getPropertyValue("--color-border").trim() || "#314039";
  const bg = style.getPropertyValue("--color-bg").trim() || "#0e1412";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  const rows = traces.length || 1;
  const rowH = height / rows;
  const labelW = 36;
  ctx.font = "11px Figtree, ui-sans-serif, sans-serif";
  ctx.textBaseline = "middle";
  traces.forEach((trace, row) => {
    const mid = row * rowH + rowH / 2;
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(labelW, mid);
    ctx.lineTo(width - 8, mid);
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.fillText(trace.id, 8, mid);
    let peak = 8;
    for (let i = 0; i < trace.samples.length; i++) peak = Math.max(peak, Math.abs(trace.samples[i]));
    const scale = (rowH * 0.42) / peak;
    ctx.strokeStyle = row % 2 === 0 ? brass : teal;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    const plotW = width - labelW - 12;
    for (let i = 0; i < trace.samples.length; i++) {
      const x = labelW + (i / Math.max(1, trace.samples.length - 1)) * plotW;
      const y = mid - trace.samples[i] * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
}

export function EegSync({
  drive,
  consent,
  reduceMotion,
  onSnapshot,
  onSync,
}: {
  drive: EegDrive;
  consent: boolean;
  reduceMotion: boolean;
  onSnapshot: (snapshot: EegSnapshot) => void;
  onSync: (armed: boolean) => void;
}) {
  const engineRef = useRef<LiveEeg | null>(null);
  if (!engineRef.current) engineRef.current = new LiveEeg();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const driveRef = useRef(drive);
  const onSnapshotRef = useRef(onSnapshot);
  const reduceRef = useRef(reduceMotion);
  driveRef.current = drive;
  onSnapshotRef.current = onSnapshot;
  reduceRef.current = reduceMotion;

  const [snap, setSnap] = useState<EegSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setDrive(driveRef.current);
    engine.start();
    const timer = window.setInterval(() => {
      engine.setDrive(driveRef.current);
      const next = engine.snapshot();
      setSnap(next);
      onSnapshotRef.current(next);
    }, 250);
    return () => {
      window.clearInterval(timer);
      engine.stop();
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setDrive(drive);
  }, [drive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;
    let frame = 0;
    let last = 0;
    const loop = (now: number) => {
      frame = window.requestAnimationFrame(loop);
      if (now - last < (reduceRef.current ? 280 : 32)) return;
      last = now;
      paint(canvas, engine.traces());
    };
    frame = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  async function connect() {
    const engine = engineRef.current;
    if (!engine || busy) return;
    setBusy(true);
    setError(null);
    try {
      await engine.connectMuse();
      const next = engine.snapshot();
      setSnap(next);
      onSnapshotRef.current(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The headset did not connect.");
    } finally {
      setBusy(false);
    }
  }

  function release() {
    engineRef.current?.disconnectMuse();
    const next = engineRef.current?.snapshot();
    if (next) {
      setSnap(next);
      onSnapshotRef.current(next);
    }
  }

  function toggleBench(kind: "classic" | "athena" = "classic") {
    const engine = engineRef.current;
    if (!engine) return;
    const current = engine.snapshot();
    const same = current.source === "bench" && current.family === (kind === "athena" ? "athena" : "classic");
    if (same) engine.stopBench();
    else engine.startBench(kind);
    const next = engine.snapshot();
    setSnap(next);
    onSnapshotRef.current(next);
  }

  const source = snap?.source ?? "model";
  const phase =
    snap?.phaseErrorDeg == null ? "Phase idle" : snap.locked ? `Locked · ${snap.phaseErrorDeg}°` : `Seeking · ${snap.phaseErrorDeg}°`;
  const maxUv = Math.max(1, ...BANDS.map((band) => snap?.bandUv[band] ?? 0));

  return (
    <section className="mx-auto max-w-6xl px-4 pt-4" aria-label="Real-time EEG">
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="font-display text-2xl text-fg">EEG sync</h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">
              A live montage measures the rhythm, then trims the tone until the two share a phase. Connect a Muse,
              or run the signal bench: the map follows those electrodes, the optical pulse, and head motion.
            </p>
          </div>
          <div className="flex flex-col items-start gap-1 md:items-end">
            <p className="text-xs tracking-widest text-brass uppercase">
              {source === "model" ? "Model stream" : snap?.family === "athena" ? (snap.deviceName ?? "Muse S Athena") : source === "bench" ? "Muse bench" : (snap?.deviceName ?? "Muse")}
              {snap?.preset && source !== "model" ? ` · ${snap.preset}` : ""}
            </p>
            <p className="text-sm text-fg">{phase}</p>
            <p className="tabular-nums text-sm text-muted">
              {snap ? `${snap.peakHz.toFixed(1)} Hz peak · quality ${snap.quality.toFixed(2)}` : "Filling a one-second window…"}
              {snap && snap.trimHz !== 0 ? ` · trim ${snap.trimHz > 0 ? "+" : ""}${snap.trimHz.toFixed(2)} Hz` : ""}
            </p>
          </div>
        </div>

        <canvas
          ref={canvasRef}
          className={source === "model" || (snap?.channels.length ?? 0) <= 4 ? "mt-3 h-56 w-full rounded-xl border border-border bg-bg" : "mt-3 h-72 w-full rounded-xl border border-border bg-bg"}
          role="img"
          aria-label={source === "model" ? "Ten-channel EEG, scrolling, two seconds" : "Muse EEG, scrolling, two seconds"}
        />

        <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-6">
          {BANDS.map((band) => {
            const uv = snap?.bandUv[band] ?? 0;
            const hot = band === "beta" || band === "gamma" || band === "smr";
            return (
              <div key={band}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-muted">{BAND_LABEL[band]}</span>
                  <span className="tabular-nums text-fg">{uv.toFixed(0)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-raised">
                  <div
                    className={hot ? "h-full bg-teal" : "h-full bg-brass"}
                    style={{ width: `${Math.round((uv / maxUv) * 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {snap && snap.channels.length > 0 ? (
          <ul className="mt-3 grid grid-cols-4 gap-2" aria-label="Electrode contact">
            {snap.channels.slice(0, 8).map((channel) => (
              <li key={channel.id} className="rounded-xl border border-border bg-bg px-2 py-2">
                <p className="text-xs tracking-widest text-muted uppercase">{channel.id}</p>
                <p className={channel.fit === 1 ? "text-sm text-teal" : channel.fit === 2 ? "text-sm text-brass" : "text-sm text-muted"}>
                  {channel.fit === 1 ? "Good" : channel.fit === 2 ? "Weak" : "Off"}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
        {source !== "model" && snap ? (
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg tabular-nums">
            <span>{snap.battery == null ? "Battery —" : `Battery ${Math.round(snap.battery)}%`}</span>
            {snap.temperatureC != null ? <span>{snap.temperatureC.toFixed(1)}°C</span> : null}
            {snap.cellV != null ? <span>{snap.cellV.toFixed(2)} V</span> : null}
            <span className="inline-flex items-center gap-1">
              <HeartPulse className="size-4 text-brass" aria-hidden="true" />
              {snap.heartBpm == null ? "Pulse —" : `${Math.round(snap.heartBpm)} bpm`}
            </span>
            <span>{snap.moving ? "Moving" : "Still"}</span>
            {snap.firmware ? <span>fw {snap.firmware}</span> : null}
          </p>
        ) : null}
        {snap && snap.optics.length > 0 ? (
          <ul className="mt-3 grid grid-cols-4 gap-2" aria-label="Athena optics">
            {snap.optics.map((optic) => (
              <li key={optic.id}>
                <p className="mb-1 text-xs tracking-widest text-muted uppercase">{optic.id.replaceAll("_", " ")}</p>
                <div className="h-2 overflow-hidden rounded-full bg-raised">
                  <div className="h-full bg-teal" style={{ width: `${Math.round(optic.level * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="mt-2 text-sm text-muted">Band height is microvolts, peak of that rhythm. Contact is good, weak, or off.</p>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={() => onSync(!drive.sync)}
            disabled={!consent}
            aria-pressed={drive.sync}
            className={
              drive.sync
                ? "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-teal px-3 text-sm text-ink"
                : "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-brass px-3 text-sm text-fg disabled:opacity-40"
            }
          >
            <Activity className="size-4" aria-hidden="true" />
            {drive.sync ? "Sync armed" : "Arm EEG sync"}
          </button>
          {source === "muse" ? (
            <button
              type="button"
              onClick={release}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm text-fg"
            >
              <BluetoothOff className="size-4" aria-hidden="true" />
              Release headset
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void connect()}
              disabled={!consent || busy || snap?.bluetooth === false}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm text-fg disabled:opacity-40"
            >
              <Bluetooth className="size-4" aria-hidden="true" />
              {busy ? "Connecting…" : "Connect Muse"}
            </button>
          )}
          {source !== "muse" ? (
            <button
              type="button"
              onClick={() => toggleBench("classic")}
              aria-pressed={source === "bench" && snap?.family !== "athena"}
              className={
                source === "bench" && snap?.family !== "athena"
                  ? "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-teal px-3 text-sm text-ink"
                  : "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm text-fg"
              }
            >
              <Radio className="size-4" aria-hidden="true" />
              {source === "bench" && snap?.family !== "athena" ? "Stop bench" : "Signal bench"}
            </button>
          ) : null}
          {source !== "muse" ? (
            <button
              type="button"
              onClick={() => toggleBench("athena")}
              aria-pressed={snap?.family === "athena"}
              className={
                snap?.family === "athena"
                  ? "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-teal px-3 text-sm text-ink"
                  : "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm text-fg"
              }
            >
              <Radio className="size-4" aria-hidden="true" />
              {snap?.family === "athena" ? "Stop Athena" : "Athena bench"}
            </button>
          ) : null}
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted">{error ?? snap?.detail ?? "Opening the model stream."}</p>
        {snap?.bluetooth === false ? (
          <p className="mt-1 text-sm leading-relaxed text-muted">
            This browser cannot open a Bluetooth headset. iPhone and iPad never can. Chrome or Edge on a computer
            or Android can pair a Muse 2, Muse S, or Muse S Athena. The signal bench runs the same decoders here.
          </p>
        ) : (
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Pairing opens the headset chooser. Muse 2 and Muse S use four electrodes, motion, and pulse. Muse S Athena
            uses preset p1035: four electrodes and four optics channels at 730 and 850 nm. Eight-electrode presets
            still decode if the band sends them. Contact is not a clinical impedance check.
          </p>
        )}
        {source !== "model" ? (
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Forehead and ear electrodes are projected onto the ten-site map. Sites without a sensor are weighted
            from the nearest real channel, not copied. Motion holds the samples so a head turn is not a rhythm.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * CIA-1 brainprint engine.
 *
 * Ports, in the browser, the pieces that actually bear on a cognitive map:
 * - Veritas coherence distributor (veritash-experimental sophia/consciousness.py)
 * - Veritas tone recovery (control-plane/control/signal_recovery.py)
 * - CIA-1 continuity vector, Ξ = v vᵀ, equal-weight SCI, trajectory stability,
 *   and the H0 connected-component proxy from cia1/topostat
 *
 * A frame is a research model of functional continuity. A live EEG montage
 * can feed it. The frame is not a diagnosis and not evidence that a subject
 * continued.
 */

export const BANDS = ["delta", "theta", "alpha", "smr", "beta", "gamma"] as const;
export const DIMS = ["causal", "memory", "behavior", "self", "topology", "embodiment"] as const;
export type BandId = (typeof BANDS)[number];
export type DimId = (typeof DIMS)[number];
export type MindMode = "absorb" | "focus";
export type AudioMode = "binaural" | "isochronic" | "monaural";
export type PinMode = "auto" | "absorb" | "focus";

const BASE: Record<BandId, number> = {
  delta: 0.22,
  theta: 0.16,
  alpha: 0.28,
  smr: 0.08,
  beta: 0.18,
  gamma: 0.08,
};

const CEILING = 1.35;

const REGION: Record<string, Record<BandId, number>> = {
  frontal: { delta: 0.7, theta: 0.9, alpha: 0.75, smr: 0.8, beta: 1.25, gamma: 1.15 },
  central: { delta: 0.8, theta: 0.75, alpha: 0.85, smr: 1.35, beta: 1.05, gamma: 0.8 },
  parietal: { delta: 0.75, theta: 1.05, alpha: 1.2, smr: 0.9, beta: 0.8, gamma: 0.7 },
  occipital: { delta: 1.1, theta: 0.85, alpha: 1.35, smr: 0.7, beta: 0.6, gamma: 0.55 },
};

export type Electrode = {
  id: string;
  svgX: number;
  svgY: number;
  torusX: number;
  torusY: number;
  hemi: "L" | "R";
  region: string;
};

export const ELECTRODES: Electrode[] = [
  { id: "Fp1", svgX: 70, svgY: 52, torusX: 32, torusY: 18, hemi: "L", region: "frontal" },
  { id: "Fp2", svgX: 130, svgY: 52, torusX: 68, torusY: 18, hemi: "R", region: "frontal" },
  { id: "F3", svgX: 58, svgY: 88, torusX: 24, torusY: 34, hemi: "L", region: "frontal" },
  { id: "F4", svgX: 142, svgY: 88, torusX: 76, torusY: 34, hemi: "R", region: "frontal" },
  { id: "C3", svgX: 46, svgY: 124, torusX: 16, torusY: 52, hemi: "L", region: "central" },
  { id: "C4", svgX: 154, svgY: 124, torusX: 84, torusY: 52, hemi: "R", region: "central" },
  { id: "P3", svgX: 62, svgY: 160, torusX: 28, torusY: 70, hemi: "L", region: "parietal" },
  { id: "P4", svgX: 138, svgY: 160, torusX: 72, torusY: 70, hemi: "R", region: "parietal" },
  { id: "O1", svgX: 80, svgY: 192, torusX: 38, torusY: 88, hemi: "L", region: "occipital" },
  { id: "O2", svgX: 120, svgY: 192, torusX: 62, torusY: 88, hemi: "R", region: "occipital" },
];

export type Protocol = {
  id: string;
  phase: string;
  title: string;
  band: BandId;
  beat: number;
  audio: AudioMode;
  summary: string;
  gains: Record<BandId, number>;
};

function gains(
  delta: number,
  theta: number,
  alpha: number,
  smr: number,
  beta: number,
  gamma: number,
): Record<BandId, number> {
  return { delta, theta, alpha, smr, beta, gamma };
}

export const PROTOCOLS: Protocol[] = [
  {
    id: "baseline",
    phase: "phase_0_consent_baseline",
    title: "Consent baseline",
    band: "alpha",
    beat: 10,
    audio: "binaural",
    summary: "10 Hz alpha. A quiet self-model before any drive.",
    gains: gains(0.15, 0.25, 1, 0.35, 0.2, 0.08),
  },
  {
    id: "mirror",
    phase: "phase_1_neural_mirror",
    title: "Neural mirror",
    band: "theta",
    beat: 6,
    audio: "binaural",
    summary: "6 Hz theta. Memory channel of the C-loop, mirrored, not migrated.",
    gains: gains(0.2, 1, 0.4, 0.18, 0.16, 0.08),
  },
  {
    id: "couple",
    phase: "phase_2_coupled_cognition",
    title: "Coupled cognition",
    band: "alpha",
    beat: 8,
    audio: "binaural",
    summary: "8 Hz border. Alpha and theta share the loop.",
    gains: gains(0.12, 0.75, 0.9, 0.3, 0.22, 0.1),
  },
  {
    id: "focus",
    phase: "phase_3_functional_integration",
    title: "Focus locus",
    band: "beta",
    beat: 18,
    audio: "binaural",
    summary: "18 Hz beta. Veritas focus: one locus, behavior and intention.",
    gains: gains(0.05, 0.12, 0.28, 0.55, 1, 0.3),
  },
  {
    id: "absorb",
    phase: "phase_0_consent_baseline",
    title: "Absorb",
    band: "delta",
    beat: 2,
    audio: "binaural",
    summary: "2 Hz delta. Veritas absorb: the spectrum is dense and awareness scatters.",
    gains: gains(1, 0.3, 0.16, 0.08, 0.06, 0.04),
  },
  {
    id: "bind",
    phase: "phase_4_continuity_verification",
    title: "Gamma bind",
    band: "gamma",
    beat: 40,
    audio: "isochronic",
    summary: "40 Hz isochronic. A short causal-binding check, not a treatment.",
    gains: gains(0.04, 0.08, 0.16, 0.22, 0.4, 1),
  },
];

export function protocolById(id: string): Protocol {
  return PROTOCOLS.find((item) => item.id === id) ?? PROTOCOLS[0];
}

export function fnv(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function unit(subject: string, electrode: string, band: string): number {
  const n = fnv(`${subject}|${electrode}|${band}`) / 0xffffffff;
  return (n * 2 - 1) * 0.045;
}

function depthOf(elapsed: number): number {
  return 1 - Math.exp(-Math.max(0, elapsed) / 12);
}

function clamp(value: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, value));
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function dist(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export function trajectoryStability(points: number[][]): number {
  if (points.length < 2) return 1;
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) length += dist(points[i], points[i + 1]);
  const span = dist(points[0], points[points.length - 1]);
  if (length < 1e-9) return 1;
  return Math.min(1, span / length);
}

export function homologyH0(points: number[][], threshold = 0.28): number {
  const n = points.length;
  if (n === 0) return 0;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (dist(points[i], points[j]) <= threshold) union(i, j);
    }
  }
  return new Set(parent.map((_, i) => find(i))).size;
}

export function siteBandPower(
  subject: string,
  electrode: string,
  region: string,
  protocol: Protocol,
  elapsed: number,
): Record<BandId, number> {
  const depth = depthOf(elapsed);
  const spatial = REGION[region];
  const out = {} as Record<BandId, number>;
  for (const band of BANDS) {
    const raw = BASE[band] + unit(subject, electrode, band) + depth * protocol.gains[band] * spatial[band];
    out[band] = Math.max(0.02, raw);
  }
  return out;
}

function sine(freq: number, n: number, sr = 256): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.sin((2 * Math.PI * freq * i) / sr));
  return out;
}

function coherentIntegrate(passes: number[][]): number[] {
  if (!passes.length) return [];
  const n = passes[0].length;
  const acc = new Array(n).fill(0);
  for (const pass of passes) {
    for (let i = 0; i < n; i++) acc[i] += pass[i];
  }
  return acc.map((value) => value / passes.length);
}

function matchedFilter(samples: number[], template: number[]): number[] {
  if (!template.length) return [];
  const tEnergy = Math.sqrt(template.reduce((sum, t) => sum + t * t, 0)) || 1;
  const out: number[] = [];
  for (let i = 0; i <= samples.length - template.length; i++) {
    let dot = 0;
    for (let j = 0; j < template.length; j++) dot += samples[i + j] * template[j];
    out.push(dot / tEnergy);
  }
  return out;
}

function adaptiveNoiseCancel(primary: number[], referenceNoise: number[], mu = 0.01, taps = 8): number[] {
  const w = new Array(taps).fill(0);
  let buf = new Array(taps).fill(0);
  const cleaned: number[] = [];
  for (let n = 0; n < primary.length; n++) {
    buf = [referenceNoise[n], ...buf.slice(0, -1)];
    let y = 0;
    for (let i = 0; i < taps; i++) y += w[i] * buf[i];
    const e = primary[n] - y;
    for (let i = 0; i < taps; i++) w[i] += mu * e * buf[i];
    cleaned.push(e);
  }
  return cleaned;
}

function carrierLock(beatHz: number, subject: string): { peak: number; index: number; lock: number } {
  const template = sine(Math.max(0.5, beatHz), 64);
  const noise: number[] = [];
  for (let i = 0; i < 256; i++) {
    const u = fnv(`${subject}|noise|${i}`) / 0xffffffff;
    noise.push((u * 2 - 1) * 0.35);
  }
  const buried = noise.slice();
  const start = 48;
  for (let j = 0; j < template.length; j++) buried[start + j] += template[j];
  const quieter = buried.map((sample) => sample * 0.92);
  const noiseRef = noise.map((sample) => sample * 0.15);
  const passes = [buried, quieter].map((pass) => adaptiveNoiseCancel(pass, noiseRef));
  const integrated = coherentIntegrate(passes);
  const mf = matchedFilter(integrated, template);
  if (!mf.length) return { peak: 0, index: -1, lock: 0 };
  let peak = mf[0];
  let index = 0;
  for (let i = 1; i < mf.length; i++) {
    if (mf[i] > peak) {
      peak = mf[i];
      index = i;
    }
  }
  return { peak, index, lock: clamp(peak / 6) };
}

type Shard = { id: string; amp: number; phase: number };

function distribute(
  nodes: { id: string; x: number; y: number; batt: number; loss: number }[],
  severed: string[],
  hits: number,
  windP: number,
  focus: string,
  pin: PinMode,
): { mode: MindMode; rho: number; shards: Shard[]; ent: number; locus: string | null; pinned: boolean; pairs: [string, string][] } {
  const tau = Math.PI * 2;
  const live = nodes.filter((node) => !severed.includes(node.id));
  const shards: Shard[] = live.map((node) => {
    const theta = (node.x / 100) * tau;
    const phi = (node.y / 100) * tau;
    const amp = roundTo(Math.max(0.05, (node.batt / 100) * (1 - Math.min(node.loss, 10) / 10)), 2);
    const phase = roundTo(((theta + windP * phi) % tau + tau) % tau, 2);
    return { id: node.id, amp, phase };
  });
  const mean = shards.reduce((sum, shard) => sum + shard.amp, 0) / (shards.length || 1);
  const variance = shards.reduce((sum, shard) => sum + (shard.amp - mean) ** 2, 0) / (shards.length || 1);
  const rho = roundTo(Math.max(0, Math.min(0.995, 1 - variance)), 3);
  const pairs: [string, string][] = [];
  for (let i = 0; i < shards.length; i++) {
    for (let j = i + 1; j < shards.length; j++) {
      const delta = Math.abs(shards[i].phase - shards[j].phase);
      if (Math.min(delta, tau - delta) < 0.45) pairs.push([shards[i].id, shards[j].id]);
    }
  }
  const dense = hits > 6 || severed.length > 0 || rho < 0.7;
  const pinned = pin === "absorb" || pin === "focus";
  const mode: MindMode = pinned ? pin : dense ? "absorb" : "focus";
  return {
    mode,
    rho,
    shards,
    ent: pairs.length,
    locus: mode === "focus" ? focus : null,
    pinned,
    pairs,
  };
}

export type ShardView = {
  id: string;
  svgX: number;
  svgY: number;
  hemi: "L" | "R";
  region: string;
  total: number;
  dominant: BandId;
  amp: number;
  phase: number;
};

export type Frame = {
  subject: string;
  protocolId: string;
  phase: string;
  title: string;
  elapsed: number;
  depth: number;
  beat: number;
  relative: Record<BandId, number>;
  bands: Record<BandId, number>;
  vector: number[];
  sci: number;
  lower: number;
  upper: number;
  tensor: number[][];
  frobenius: number;
  symmetry: number;
  lock: number;
  lockIndex: number;
  rho: number;
  mode: MindMode;
  pinned: boolean;
  locus: string | null;
  entangled: [string, string][];
  shards: ShardView[];
  stability: number;
  px: number;
  py: number;
  h0: number;
  anchorInput: string;
  leading: DimId;
};

function measuredPowers(raw: Record<BandId, number>): Record<BandId, number> {
  const out = {} as Record<BandId, number>;
  for (const band of BANDS) {
    const value = raw[band];
    out[band] = Number.isFinite(value) ? Math.max(0.02, value) : 0.02;
  }
  return out;
}

export function computeFrame(input: {
  subject: string;
  protocolId: string;
  elapsed: number;
  beat: number;
  pin: PinMode;
  history: number[][];
  /** Per-electrode band powers already in engine scale. Null uses the model. */
  measured?: Record<string, Record<BandId, number>> | null;
  /** Live carrier-lock stand-in from the EEG phase loop. Null keeps the model. */
  liveLock?: number | null;
}): Frame {
  const subject = input.subject.trim() || "did:monarch:session";
  const protocol = protocolById(input.protocolId);
  const elapsed = Math.max(0, input.elapsed);
  const mean = {} as Record<BandId, number>;
  for (const band of BANDS) mean[band] = 0;
  let left = 0;
  let right = 0;
  let leftN = 0;
  let rightN = 0;
  let bestId = ELECTRODES[0].id;
  let bestTotal = -1;
  const perSite: { electrode: Electrode; powers: Record<BandId, number>; total: number }[] = [];
  for (const electrode of ELECTRODES) {
    const measuredSite = input.measured?.[electrode.id];
    const powers = measuredSite ? measuredPowers(measuredSite) : siteBandPower(subject, electrode.id, electrode.region, protocol, elapsed);
    const total = BANDS.reduce((sum, band) => sum + powers[band], 0);
    perSite.push({ electrode, powers, total });
    for (const band of BANDS) mean[band] += powers[band];
    if (electrode.hemi === "L") {
      left += total;
      leftN += 1;
    } else {
      right += total;
      rightN += 1;
    }
    if (total > bestTotal) {
      bestTotal = total;
      bestId = electrode.id;
    }
  }
  for (const band of BANDS) mean[band] /= ELECTRODES.length;
  const totalMean = BANDS.reduce((sum, band) => sum + mean[band], 0) || 1;
  const relative = {} as Record<BandId, number>;
  for (const band of BANDS) relative[band] = mean[band] / totalMean;
  const symmetry = 1 - Math.abs(left / leftN - right / rightN) / Math.max(1e-9, left / leftN + right / rightN);
  const modeled = carrierLock(input.beat, subject);
  const live = input.liveLock;
  const lockValue =
    live == null || !Number.isFinite(live) ? modeled.lock : clamp(0.35 * modeled.lock + 0.65 * clamp(live));
  const vector = [
    clamp(mean.gamma / CEILING),
    clamp(mean.theta / CEILING),
    clamp(mean.beta / CEILING),
    clamp(mean.alpha / CEILING),
    clamp((mean.smr / CEILING) * (0.55 + 0.45 * symmetry)),
    clamp((mean.delta / CEILING) * (0.7 + 0.3 * lockValue)),
  ];
  const sci = vector.reduce((sum, value) => sum + value, 0) / 6;
  const tensor = vector.map((row) => vector.map((col) => row * col));
  const frobenius = Math.sqrt(tensor.flat().reduce((sum, value) => sum + value * value, 0));
  const hits = protocol.id === "absorb" ? 9 : BANDS.filter((band) => relative[band] > 0.18).length;
  const nodes = perSite.map(({ electrode, total }) => ({
    id: electrode.id,
    x: electrode.torusX,
    y: electrode.torusY,
    batt: Math.max(12, Math.min(100, total * 22)),
    loss: (fnv(`${subject}|loss|${electrode.id}`) % 30) / 10,
  }));
  const mind = distribute(nodes, [], hits, 1, bestId, input.pin);
  const byId = new Map(mind.shards.map((shard) => [shard.id, shard]));
  const cloud: number[][] = [];
  const shards: ShardView[] = perSite.map(({ electrode, powers, total }) => {
    cloud.push(BANDS.map((band) => powers[band]));
    let dominant: BandId = "alpha";
    let best = -1;
    for (const band of BANDS) {
      if (powers[band] > best) {
        best = powers[band];
        dominant = band;
      }
    }
    const shard = byId.get(electrode.id)!;
    return {
      id: electrode.id,
      svgX: electrode.svgX,
      svgY: electrode.svgY,
      hemi: electrode.hemi,
      region: electrode.region,
      total,
      dominant,
      amp: shard.amp,
      phase: shard.phase,
    };
  });
  const path = [...input.history, vector];
  let leading: DimId = "self";
  let lead = -1;
  vector.forEach((value, index) => {
    if (value > lead) {
      lead = value;
      leading = DIMS[index];
    }
  });
  const anchorInput = `${subject}|${protocol.id}|${vector.map((value) => value.toFixed(3)).join(",")}|${mind.mode}|${mind.rho.toFixed(3)}`;
  return {
    subject,
    protocolId: protocol.id,
    phase: protocol.phase,
    title: protocol.title,
    elapsed,
    depth: depthOf(elapsed),
    beat: input.beat,
    relative,
    bands: { ...mean },
    vector,
    sci,
    lower: Math.max(0, sci - 0.05),
    upper: Math.min(1, sci + 0.05),
    tensor,
    frobenius,
    symmetry,
    lock: lockValue,
    lockIndex: modeled.index,
    rho: mind.rho,
    mode: mind.mode,
    pinned: mind.pinned,
    locus: mind.locus,
    entangled: mind.pairs,
    shards,
    stability: trajectoryStability(path),
    px: vector[3] - vector[2],
    py: vector[1] - vector[0],
    h0: homologyH0(cloud, 0.28),
    anchorInput,
    leading,
  };
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

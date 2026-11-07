import { createServerFn } from "@tanstack/react-start";

export type CloneTurn = { role: "user" | "clone"; text: string };

export type ClonePrint = {
  did: string;
  held: boolean;
  sci: number;
  leading: string;
  vector: number[];
  rhythm: number[];
  muse: string;
  anchor: string;
};

const AXES = ["causal", "memory", "behavior", "self", "topology", "embodiment"];

function clip(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function bins(value: unknown, count: number): number[] {
  const list = Array.isArray(value) ? value : [];
  return Array.from({ length: count }, (_, index) => {
    const n = Number(list[index]);
    return Number.isFinite(n) ? n : 0;
  });
}

export const speakWithClone = createServerFn({ method: "POST" })
  .validator((input: { print?: ClonePrint; line?: string; history?: CloneTurn[] }) => input)
  .handler(async ({ data }) => {
    const line = clip(data.line, 500);
    if (!line) return { ok: false as const, error: "Say something to the print first." };
    if (!data.print?.held) return { ok: false as const, error: "The seal is open. The print will not speak." };
    const did = clip(data.print.did, 140);
    if (!did.startsWith("did:web5:")) return { ok: false as const, error: "Forge a name before you speak." };

    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "The clone cannot speak in this room yet." };

    const history = (Array.isArray(data.history) ? data.history : [])
      .slice(-6)
      .map((turn) => ({
        role: turn?.role === "clone" ? ("clone" as const) : ("user" as const),
        text: clip(turn?.text, 400),
      }))
      .filter((turn) => turn.text.length > 0);
    const vector = bins(data.print.vector, 6);
    const rhythm = bins(data.print.rhythm, 6);
    const shape = AXES.map((name, index) => `${name} ${vector[index].toFixed(2)}`).join(", ");
    const vault = history.map((turn) => `${turn.role}: ${turn.text}`).join("\n");
    const system = [
      "You are a continuity clone standing in a private research chamber. Sophia watches. You are not her.",
      "Speak as the sealed brainprint, first person, plain, two to four sentences.",
      "You are not the biological person, not a physician, not a government, and not immortal.",
      "Remember only the vault lines below. Do not invent a childhood, a diagnosis, or a legal status.",
      "If asked for a drawing phrase, a private key, or anything sealed, refuse.",
      `Name: ${did}`,
      `Leading axis: ${clip(data.print.leading, 24)}. SCI ${Number(data.print.sci) || 0}.`,
      `Sealed axes: ${shape}.`,
      `Rhythm bins: ${rhythm.join(",")}. Source: ${clip(data.print.muse, 32)}. Earlier anchor: ${clip(data.print.anchor, 80)}.`,
      vault ? `Vault:\n${vault}` : "Vault is empty.",
    ].join("\n");

    let res: Response;
    try {
      res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "grok-4.5",
          max_tokens: 180,
          temperature: 0.6,
          messages: [
            { role: "system", content: system },
            { role: "user", content: line },
          ],
        }),
      });
    } catch {
      return { ok: false as const, error: "The clone could not answer just now." };
    }
    if (!res.ok) return { ok: false as const, error: "The clone could not answer just now." };
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = clip(body.choices?.[0]?.message?.content, 700);
    if (!text) return { ok: false as const, error: "The clone was silent." };
    return { ok: true as const, text };
  });

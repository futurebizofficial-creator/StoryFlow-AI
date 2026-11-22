/**
 * Extracts usage/rate-limit information that providers return in response headers
 * (e.g. x-ratelimit-remaining-requests, X-Ratelimit-Limit, anthropic-ratelimit-*).
 * Pure and dependency-free so it can be unit tested.
 */
export interface UsageLimit {
  label: string;
  value: string;
}

const LABELS: Array<[RegExp, string]> = [
  [/remaining-requests|requests-remaining/i, "Requests remaining"],
  [/limit-requests|requests-limit/i, "Request limit"],
  [/remaining-tokens|tokens-remaining|input-tokens-remaining|output-tokens-remaining/i, "Tokens remaining"],
  [/limit-tokens|tokens-limit/i, "Token limit"],
  [/reset/i, "Resets"],
  [/remaining/i, "Requests remaining"],
  [/limit/i, "Request limit"],
];

export function usageFromHeaders(headers: { forEach: (cb: (value: string, key: string) => void) => void }): UsageLimit[] {
  const out = new Map<string, string>();
  headers.forEach((value, key) => {
    if (!/ratelimit/i.test(key)) return;
    const clean = value.trim().slice(0, 60);
    if (!clean || !/^[\w.:\-+ /TZ]+$/.test(clean)) return;
    const label = LABELS.find(([re]) => re.test(key))?.[1];
    if (label && !out.has(label)) out.set(label, clean);
  });
  return Array.from(out, ([label, value]) => ({ label, value }));
}

/** ElevenLabs /v1/user/subscription → character usage for the current period. */
export function elevenLabsUsage(body: unknown): UsageLimit[] {
  if (!body || typeof body !== "object") return [];
  const b = body as { character_count?: unknown; character_limit?: unknown; tier?: unknown };
  const out: UsageLimit[] = [];
  if (typeof b.tier === "string") out.push({ label: "Plan", value: b.tier.slice(0, 40) });
  if (typeof b.character_count === "number" && typeof b.character_limit === "number") {
    out.push({ label: "Characters used", value: `${b.character_count.toLocaleString("en-US")} / ${b.character_limit.toLocaleString("en-US")}` });
  }
  return out;
}

/** Model ids from OpenAI-compatible, Anthropic, Together (bare array) or Gemini list responses. */
export function modelIdsFromList(body: unknown): string[] {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === "object"
      ? ((body as { data?: unknown; models?: unknown }).data ?? (body as { models?: unknown }).models)
      : null;
  if (!Array.isArray(list)) return [];
  const ids: string[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const m = item as { id?: unknown; name?: unknown; supportedGenerationMethods?: unknown };
    if (Array.isArray(m.supportedGenerationMethods) && !m.supportedGenerationMethods.includes("generateContent")) continue;
    const raw = typeof m.id === "string" ? m.id : typeof m.name === "string" ? m.name.replace(/^models\//, "") : null;
    if (raw && /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/.test(raw)) ids.push(raw);
  }
  return Array.from(new Set(ids)).sort().slice(0, 300);
}

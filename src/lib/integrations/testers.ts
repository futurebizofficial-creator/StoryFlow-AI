import "server-only";
import { getProvider } from "@/lib/integrations/catalog";
import { elevenLabsUsage, modelIdsFromList, usageFromHeaders, type UsageLimit } from "@/lib/integrations/limits";

/**
 * Connection tests. Every test calls a free, read-only metadata endpoint (model lists,
 * account info, a single curated/search result) — never a generation endpoint — so testing
 * cannot create charges. Keys are sent only to the provider's own API host and are never
 * returned, logged or included in error messages.
 */

export interface TestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
  limits?: UsageLimit[];
  models?: string[];
}

const TIMEOUT_MS = 10_000;
const USER_AGENT = "StoryFlowAI/1.0 (integrations connection test)";

interface Probe {
  url: string;
  headers?: Record<string, string>;
  /** Extracts a short success message and optional extras from the JSON body. */
  read?: (body: unknown) => { message?: string; models?: string[]; limits?: UsageLimit[] };
}

function bearer(key: string) {
  return { Authorization: `Bearer ${key}` };
}

function probeFor(id: string, key: string | null): Probe | null {
  const def = getProvider(id);
  if (!def) return null;
  if (def.llm?.api === "openai") {
    return {
      url: `${def.llm.baseUrl}/models`,
      headers: bearer(key ?? ""),
      read: (b) => {
        const models = modelIdsFromList(b);
        return { models, message: `${models.length} models available` };
      },
    };
  }
  switch (id) {
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/models?limit=100",
        headers: { "x-api-key": key ?? "", "anthropic-version": "2023-06-01" },
        read: (b) => {
          const models = modelIdsFromList(b);
          return { models, message: `${models.length} models available` };
        },
      };
    case "gemini":
      return {
        url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
        headers: { "x-goog-api-key": key ?? "" },
        read: (b) => {
          const models = modelIdsFromList(b);
          return { models, message: `${models.length} text models available` };
        },
      };
    case "replicate":
      return { url: "https://api.replicate.com/v1/account", headers: bearer(key ?? ""), read: () => ({ message: "Account reachable" }) };
    case "elevenlabs":
      return {
        url: "https://api.elevenlabs.io/v1/user/subscription",
        headers: { "xi-api-key": key ?? "" },
        read: (b) => ({ message: "Subscription reachable", limits: elevenLabsUsage(b) }),
      };
    case "google_tts":
      return {
        url: "https://texttospeech.googleapis.com/v1/voices",
        headers: { "x-goog-api-key": key ?? "" },
        read: (b) => {
          const voices = (b as { voices?: unknown[] })?.voices;
          return { message: `${Array.isArray(voices) ? voices.length : 0} voices available` };
        },
      };
    case "pexels":
      return { url: "https://api.pexels.com/v1/curated?per_page=1", headers: { Authorization: key ?? "" }, read: () => ({ message: "Search API reachable" }) };
    case "pixabay":
      // Pixabay only accepts the key as a query parameter; the URL is never logged or returned.
      return { url: `https://pixabay.com/api/?key=${encodeURIComponent(key ?? "")}&q=nature&per_page=3`, read: () => ({ message: "Search API reachable" }) };
    case "unsplash":
      return { url: "https://api.unsplash.com/photos?per_page=1", headers: { Authorization: `Client-ID ${key ?? ""}`, "Accept-Version": "v1" }, read: () => ({ message: "Search API reachable" }) };
    case "wikimedia":
      return { url: "https://commons.wikimedia.org/w/api.php?action=query&meta=siteinfo&format=json", read: () => ({ message: "Public API reachable (no key needed)" }) };
    case "internet_archive":
      return { url: "https://archive.org/advancedsearch.php?q=collection%3Aprelinger&fl%5B%5D=identifier&rows=1&output=json", read: () => ({ message: "Public API reachable (no key needed)" }) };
    default:
      return null;
  }
}

function statusMessage(status: number) {
  if (status === 401 || status === 403) return `The provider rejected this key (${status}). Check the key and its permissions.`;
  if (status === 402) return "The provider reports no remaining balance or credits (402).";
  if (status === 429) return "Rate limit or quota reached (429). Try again later or check your plan.";
  if (status >= 500) return `The provider is unavailable right now (${status}).`;
  return `The provider returned an error (${status}).`;
}

export async function testProviderConnection(id: string, key: string | null): Promise<TestResult> {
  const def = getProvider(id);
  if (!def) return { ok: false, message: "Unknown provider." };
  if (def.auth === "api_key" && !key) return { ok: false, message: "Save an API key first." };
  const probe = probeFor(id, key);
  if (!probe) return { ok: false, message: "Connection tests are not available for this provider." };

  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(probe.url, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...probe.headers },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, message: "Could not reach the provider (network error or timeout)." };
  }
  const latencyMs = Date.now() - started;
  const headerLimits = usageFromHeaders(response.headers);
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return { ok: false, message: statusMessage(response.status), latencyMs, limits: headerLimits };
  }
  const body = await response.json().catch(() => null);
  const extra = probe.read?.(body) ?? {};
  return {
    ok: true,
    message: extra.message ?? "Connected",
    latencyMs,
    limits: [...(extra.limits ?? []), ...headerLimits],
    models: extra.models,
  };
}

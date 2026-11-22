import "server-only";
import { normalizeVoiceCatalog, type VoiceGroup } from "@/lib/video/render-settings";

// Server-only access to the private video engines. The engine URLs and VIDEO_ENGINE_TOKEN
// are read from the server environment and never sent to the browser.

function engineUrl(name: "AUTOMATED_VIDEO_GENERATOR_URL") {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is not configured.`);
  const url = new URL(raw);
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") throw new Error(`${name} must use HTTPS in production.`);
  if (url.username || url.password) throw new Error(`${name} must not embed credentials in its URL.`);
  return url.toString().replace(/\/$/, "");
}

/** Same gateway credential the worker sends (see worker/video-worker.mjs privateHeaders). */
function engineHeaders(): Record<string, string> {
  const token = process.env.VIDEO_ENGINE_TOKEN?.trim();
  if (!token && process.env.NODE_ENV === "production") throw new Error("VIDEO_ENGINE_TOKEN is required in production.");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Read-only GET to the private engine with the gateway token. */
async function getJson<T>(url: string, ms: number): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: engineHeaders(),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(ms),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Video engine request failed (${response.status}).`);
  return body as T;
}

// Rendering is started only by the worker (worker/video-worker.mjs). The web service's
// engine access is limited to the read-only voice catalog below.

// ---------------------------------------------------------------------------
// Voice catalog — AVG GET /api/voices, cached in memory per server instance.
// ---------------------------------------------------------------------------

export type VoiceCatalog =
  | { status: "ok"; groups: VoiceGroup[] }
  | { status: "unconfigured" }
  | { status: "unavailable" };

const VOICE_TTL_MS = 60 * 60 * 1000; // one hour
const VOICE_RETRY_MS = 60 * 1000; // retry failures after a minute
let voiceCache: { expires: number; value: VoiceCatalog } | null = null;
let voiceInflight: Promise<VoiceCatalog> | null = null;

async function fetchVoiceCatalog(): Promise<VoiceCatalog> {
  try {
    const root = engineUrl("AUTOMATED_VIDEO_GENERATOR_URL");
    const groups = normalizeVoiceCatalog(await getJson<unknown>(`${root}/api/voices`, 6_000));
    return groups && groups.length ? { status: "ok", groups } : { status: "unavailable" };
  } catch {
    // Details (URL, status) stay server-side; the UI only needs to fall back.
    return { status: "unavailable" };
  }
}

/** Returns AVG's voices grouped by locale, or a status the UI can fall back from. */
export async function listEngineVoices(): Promise<VoiceCatalog> {
  if (!process.env.AUTOMATED_VIDEO_GENERATOR_URL) return { status: "unconfigured" };
  const now = Date.now();
  if (voiceCache && voiceCache.expires > now) return voiceCache.value;
  voiceInflight ??= fetchVoiceCatalog()
    .then((value) => {
      voiceCache = { value, expires: Date.now() + (value.status === "ok" ? VOICE_TTL_MS : VOICE_RETRY_MS) };
      return value;
    })
    .finally(() => {
      voiceInflight = null;
    });
  return voiceInflight;
}

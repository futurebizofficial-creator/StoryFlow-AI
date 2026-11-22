// Scene-planning language-model adapters with explicit, configured-only fallback.
//
// Provider metadata (pricing, API style, base URL) comes from the same catalog the web app
// uses, so Free Mode and paid classification cannot drift between UI and worker.
//
// Safety rules enforced here (the web app enforces them too; members can write
// video_jobs.request directly, so the worker must not trust it):
// - Only providers listed in the job's plan are ever called, in that order.
// - Free Mode: no paid provider may appear in the plan at all.
// - Paid providers require the render to have acknowledged paid usage.
// - Keys are the job creator's own keys; a missing key or a workspace-disabled provider is
//   skipped, never substituted.
import catalog from "../src/lib/integrations/catalog.json" with { type: "json" };

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;
const PROVIDERS = new Map(catalog.providers.filter((p) => p.llm).map((p) => [p.id, p]));

export const SCENE_SYSTEM_PROMPT =
  "You are a video production assistant. Preserve the user's meaning and wording. Return a concise visual bible (one recurring character description) followed by the original script with one [Visual: ...] cue per scene. Do not add claims or instructions outside the script.";

export class AiPlanError extends Error {}

export class ProviderCallError extends Error {
  /**
   * @param {string} provider
   * @param {"quota"|"auth"|"unavailable"|"model_unavailable"|"bad_response"} kind
   * @param {string} message
   * @param {number} status
   * @param {string|null} [model]
   * @param {string|null} [detail]
   */
  constructor(provider, kind, message, status, model = null, detail = null) {
    super(message);
    this.provider = provider;
    this.kind = kind;
    this.status = status;
    this.model = model;
    this.detail = detail;
  }
}

/**
 * Gemini addresses models as "gemini-x"; list responses and some saved values use the
 * resource name "models/gemini-x". Normalise so the request path is always /models/gemini-x.
 */
export function normalizeModelId(id, model) {
  if (typeof model !== "string") return model;
  const m = model.trim();
  return PROVIDERS.get(id)?.llm.api === "gemini" ? m.replace(/^models\//, "") : m;
}

/**
 * The provider's own error message (Gemini, OpenAI-compatible and Anthropic all use
 * error.message), with anything key-like removed and length capped. Never includes the key.
 */
export function providerErrorDetail(body) {
  if (!body || typeof body !== "object") return null;
  const raw =
    typeof body.error === "string"
      ? body.error
      : typeof body.error?.message === "string"
        ? body.error.message
        : typeof body.message === "string"
          ? body.message
          : null;
  if (!raw) return null;
  return raw
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, "[redacted]")
    .replace(/\b(sk|gsk|hf|r8|xai)[-_][A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/([?&](key|api_key|token)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export function providerName(id) {
  return PROVIDERS.get(id)?.name ?? id;
}

/**
 * Validates and normalises request.ai. Jobs created before provider selection have no plan:
 * they keep the original behaviour (Claude with the worker's default model).
 */
export function resolveJobAiPlan(request) {
  const ai = request && typeof request === "object" ? request.ai : undefined;
  if (ai === undefined || ai === null) {
    return { legacy: true, freeMode: false, providers: [{ id: "anthropic", model: null, paid: true }] };
  }
  if (typeof ai !== "object" || Array.isArray(ai)) throw new AiPlanError("Invalid AI provider settings.");
  if (!Array.isArray(ai.providers) || ai.providers.length < 1 || ai.providers.length > 4) {
    throw new AiPlanError("Invalid AI provider list.");
  }
  const seen = new Set();
  const providers = ai.providers.map((entry) => {
    const id = entry && typeof entry === "object" ? entry.id : undefined;
    const def = PROVIDERS.get(id);
    if (!def || seen.has(id)) throw new AiPlanError("Unsupported AI provider in render settings.");
    seen.add(id);
    const model = entry.model === null || entry.model === undefined || entry.model === "" ? null : entry.model;
    if (model !== null && (typeof model !== "string" || !MODEL_PATTERN.test(model))) throw new AiPlanError(`Invalid ${def.name} model.`);
    if (model === null && id !== "anthropic") throw new AiPlanError(`No ${def.name} model configured.`);
    return { id, model, paid: def.pricing === "paid" };
  });
  const freeMode = ai.freeMode === true;
  if (freeMode && providers.some((p) => p.paid)) {
    throw new AiPlanError("Free Mode is on, but the render lists a paid AI provider. Generation stopped.");
  }
  if (!freeMode && providers.some((p) => p.paid) && ai.paidAcknowledged !== true) {
    throw new AiPlanError("This render uses a paid AI provider but paid usage was not confirmed.");
  }
  return { legacy: false, freeMode, providers };
}

/** Builds the HTTP request for one provider (no network). */
export function buildLlmRequest(id, modelInput, apiKey, system, user, defaultClaudeModel, maxTokens = 1800) {
  const def = PROVIDERS.get(id);
  if (!def) throw new AiPlanError("Unsupported AI provider.");
  const { api, baseUrl } = def.llm;
  const model = normalizeModelId(id, modelInput);
  if (api === "anthropic") {
    return {
      url: `${baseUrl}/messages`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: model || defaultClaudeModel, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
      },
    };
  }
  if (api === "gemini") {
    return {
      url: `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: maxTokens },
        }),
      },
    };
  }
  return {
    url: `${baseUrl}/chat/completions`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    },
  };
}

/** Extracts generated text from a provider response body. */
export function parseLlmText(id, body) {
  const api = PROVIDERS.get(id)?.llm.api;
  if (!body || typeof body !== "object") return "";
  if (api === "anthropic") {
    return (Array.isArray(body.content) ? body.content : []).filter((p) => p?.type === "text").map((p) => p.text).join("\n");
  }
  if (api === "gemini") {
    const parts = body.candidates?.[0]?.content?.parts;
    return (Array.isArray(parts) ? parts : []).map((p) => (typeof p?.text === "string" ? p.text : "")).join("");
  }
  const content = body.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

export function classifyStatus(status) {
  if (status === 429 || status === 402) return "quota";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "model_unavailable";
  if (status >= 500 || status === 408) return "unavailable";
  return "bad_response";
}

/** "Google Gemini (model gemini-x): model not found or not available for this key (404) — <provider message>" */
export function describeProviderError(err) {
  const name = providerName(err.provider);
  const who = err.model ? `${name} (model ${err.model})` : name;
  const what =
    err.kind === "quota"
      ? `quota or credits exhausted (${err.status})`
      : err.kind === "auth"
        ? `key rejected (${err.status})`
        : err.kind === "model_unavailable"
          ? `model not found or not available for this API key (${err.status})`
          : err.message;
  return `${who}: ${what}${err.detail ? ` — ${err.detail}` : ""}`;
}

/**
 * Runs scene planning through the plan's providers in order, falling back only to the next
 * configured provider. Throws a readable summary when every provider fails.
 *
 * @param {{ plan: ReturnType<typeof resolveJobAiPlan>, system: string, user: string,
 *   getKey: (id: string) => Promise<string|null>, isDisabled: (id: string) => boolean,
 *   fetchImpl?: typeof fetch, defaultClaudeModel: string, timeoutMs?: number }} options
 */
export async function planScenesWithFallback(options) {
  const { plan, system, user, getKey, isDisabled, defaultClaudeModel } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const failures = [];
  for (const provider of plan.providers) {
    if (!plan.legacy && isDisabled(provider.id)) {
      failures.push(`${providerName(provider.id)}: disabled for this workspace`);
      continue;
    }
    const key = await getKey(provider.id);
    if (!key) {
      failures.push(`${providerName(provider.id)}: no API key saved`);
      continue;
    }
    const model = normalizeModelId(provider.id, provider.model) || (provider.id === "anthropic" ? defaultClaudeModel : null);
    const { url, init } = buildLlmRequest(provider.id, provider.model, key, system, user, defaultClaudeModel);
    try {
      let res;
      try {
        res = await fetchImpl(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(options.timeoutMs ?? 90_000) });
      } catch {
        throw new ProviderCallError(provider.id, "unavailable", "network error or timeout", 0, model);
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new ProviderCallError(provider.id, classifyStatus(res.status), `request failed (${res.status})`, res.status, model, providerErrorDetail(body));
      }
      return { text: parseLlmText(provider.id, body), provider: provider.id, model };
    } catch (err) {
      if (!(err instanceof ProviderCallError)) throw err;
      failures.push(describeProviderError(err));
    }
  }
  const prefix = plan.freeMode
    ? "Scene planning stopped: no free-tier AI provider could complete the request (Free Mode never falls back to paid providers)."
    : "Scene planning failed for every configured AI provider.";
  throw new Error(`${prefix} ${failures.join("; ")}.`);
}

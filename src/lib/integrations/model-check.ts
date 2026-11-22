import "server-only";
import { getProvider } from "@/lib/integrations/catalog";
import { testProviderConnection } from "@/lib/integrations/testers";
// Same request builder and error handling the render worker uses, so a model that passes here
// is called exactly the same way during generation.
import {
  buildLlmRequest,
  classifyStatus,
  describeProviderError,
  normalizeModelId,
  parseLlmText,
  ProviderCallError,
  providerErrorDetail,
} from "../../../worker/llm-providers.mjs";

export interface ModelListResult {
  ok: boolean;
  models: string[];
  error?: string;
}

/** Live list of models that support text generation, fetched with the caller's own key. */
export async function listGenerationModels(provider: string, key: string): Promise<ModelListResult> {
  const result = await testProviderConnection(provider, key);
  if (!result.ok) return { ok: false, models: [], error: result.message };
  return { ok: true, models: result.models ?? [] };
}

export interface ModelTestResult {
  ok: boolean;
  model: string;
  message: string;
  latencyMs?: number;
}

/**
 * Sends one minimal generation request ("Reply with OK", a few output tokens) to confirm the
 * model accepts generateContent / chat completions for this key. Runs only when the user
 * clicks "Test model"; on paid providers it uses a handful of tokens.
 */
export async function testModelGeneration(provider: string, modelInput: string, key: string): Promise<ModelTestResult> {
  const def = getProvider(provider);
  const model = normalizeModelId(provider, modelInput) as string;
  if (!def?.llm) return { ok: false, model, message: "This provider is not a language model." };
  const { url, init } = buildLlmRequest(provider, model, key, "Reply with the single word OK.", "Say OK.", model, 16);
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, { ...(init as unknown as RequestInit), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000) });
  } catch {
    return { ok: false, model, message: `${def.name} (model ${model}): network error or timeout` };
  }
  const body = await res.json().catch(() => null);
  const latencyMs = Date.now() - started;
  if (!res.ok) {
    const err = new ProviderCallError(provider, classifyStatus(res.status), `request failed (${res.status})`, res.status, model, providerErrorDetail(body));
    return { ok: false, model, message: describeProviderError(err), latencyMs };
  }
  const text = String(parseLlmText(provider, body) ?? "").trim().slice(0, 40);
  return { ok: true, model, message: text ? `Model responded: "${text}"` : "Model accepted the request.", latencyMs };
}

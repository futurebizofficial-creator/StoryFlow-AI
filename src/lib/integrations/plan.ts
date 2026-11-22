/**
 * Resolves which language-model providers a render may use for scene planning, in order.
 * Shared by the AI Video Studio (to explain choices) and the server action (to enforce them).
 * The worker re-checks the stored plan (worker/llm-providers.mjs).
 *
 * Rules:
 * - Only providers that are LLMs, not disabled by the workspace, and have the user's key.
 * - Free Mode removes every paid provider; there is never a paid fallback in Free Mode.
 * - Outside Free Mode, paid providers need explicit acknowledgement per render.
 * - Fallbacks are only the providers the workspace configured, in that order.
 */
import { getProvider, isLlmProvider } from "./catalog.ts";

export const MAX_AI_PROVIDERS = 4;
/** Claude keeps working without a configured model (the worker's CLAUDE_MODEL default). */
export const MODEL_OPTIONAL = new Set(["anthropic"]);
export const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;

export interface GenerationSettings {
  freeMode: boolean;
  aiProviders: string[];
  aiModels: Record<string, string>;
  /** True only when the workspace has never saved settings (original Claude behaviour). */
  isDefault?: boolean;
}

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  freeMode: false,
  aiProviders: ["anthropic"],
  aiModels: {},
  isDefault: true,
};

export interface PlannedProvider {
  id: string;
  model: string | null;
  paid: boolean;
}

export interface ExcludedProvider {
  id: string;
  reason: string;
}

export type ResolvedPlan =
  | { ok: true; providers: PlannedProvider[]; usesPaid: boolean; excluded: ExcludedProvider[] }
  | { ok: false; error: string; excluded: ExcludedProvider[] };

/**
 * Normalises a workspace_generation_settings row. Only a missing row (never configured) falls
 * back to the original Claude default; a saved row is never silently replaced by Claude — if it
 * has no valid providers the list is empty and generation reports that clearly.
 * Callers must handle read errors themselves instead of passing null.
 */
export function normalizeSettings(row: unknown): GenerationSettings {
  if (!row || typeof row !== "object") return { ...DEFAULT_GENERATION_SETTINGS, aiProviders: [...DEFAULT_GENERATION_SETTINGS.aiProviders], aiModels: {} };
  const r = row as { free_mode?: unknown; ai_providers?: unknown; ai_models?: unknown };
  const providers = Array.isArray(r.ai_providers) ? r.ai_providers.filter((p): p is string => typeof p === "string" && isLlmProvider(p)) : [];
  const models: Record<string, string> = {};
  if (r.ai_models && typeof r.ai_models === "object" && !Array.isArray(r.ai_models)) {
    for (const [k, v] of Object.entries(r.ai_models as Record<string, unknown>)) {
      if (isLlmProvider(k) && typeof v === "string" && MODEL_PATTERN.test(v)) models[k] = v;
    }
  }
  return {
    freeMode: r.free_mode === true,
    aiProviders: Array.from(new Set(providers)).slice(0, MAX_AI_PROVIDERS),
    aiModels: models,
    isDefault: false,
  };
}

/** Gemini list responses use "models/<id>"; requests use "<id>". Mirrors the worker's normalisation. */
export function normalizeModel(provider: string, model: string): string {
  const m = model.trim();
  return getProvider(provider)?.llm?.api === "gemini" ? m.replace(/^models\//, "") : m;
}

/**
 * Checks a chosen model against the provider's live model list (fetched with the user's key and
 * filtered to text-generation models). No model names are hard-coded.
 */
export function modelAvailability(provider: string, model: string, liveModels: readonly string[]): { ok: boolean; model: string; message: string | null } {
  const normalized = normalizeModel(provider, model);
  const live = new Set(liveModels.map((m) => normalizeModel(provider, m)));
  if (live.has(normalized)) return { ok: true, model: normalized, message: null };
  const name = getProvider(provider)?.name ?? provider;
  return {
    ok: false,
    model: normalized,
    message: `${name} model "${normalized}" is not available for your API key (it may be retired or not support text generation). Choose a model from the list.`,
  };
}

/** Whether a provider may be chosen in the settings form, and why not. Mirrors the save rules. */
export function providerSelectability(
  id: string,
  ctx: { freeMode: boolean; keys: ReadonlySet<string>; disabled: ReadonlySet<string> },
): { selectable: boolean; reason: string | null } {
  const def = getProvider(id);
  if (!def?.llm) return { selectable: false, reason: "Not a language model" };
  if (ctx.disabled.has(id)) return { selectable: false, reason: "disabled for this workspace" };
  if (!ctx.keys.has(id)) return { selectable: false, reason: "not connected" };
  if (ctx.freeMode && def.pricing === "paid") return { selectable: false, reason: "paid — blocked in Free Mode" };
  return { selectable: true, reason: null };
}

/**
 * Turning Free Mode on removes paid providers from the order (primary and fallbacks) and moves
 * the remaining providers up, so a paid provider can never stay selected-but-hidden.
 */
export function applyFreeModeToOrder(order: string[]): { order: string[]; removed: string[] } {
  const removed = order.filter((id) => id && getProvider(id)?.pricing === "paid");
  const kept = order.filter((id) => id && getProvider(id)?.pricing !== "paid");
  return { order: Array.from({ length: order.length }, (_, i) => kept[i] ?? ""), removed };
}

/** Server-side validation for saving generation settings (shared with tests). */
export function validateGenerationSettings(input: {
  freeMode: boolean;
  providers: string[];
  models: Record<string, string>;
  keys: ReadonlySet<string>;
  disabled: ReadonlySet<string>;
}): { ok: true; providers: string[]; models: Record<string, string> } | { ok: false; error: string; field?: string } {
  const providers: string[] = [];
  for (const id of input.providers) {
    if (!id) continue;
    if (!isLlmProvider(id)) return { ok: false, error: "Choose valid AI providers.", field: "provider_0" };
    if (!providers.includes(id)) providers.push(id);
  }
  if (providers.length === 0) return { ok: false, error: "Choose at least one AI provider.", field: "provider_0" };
  if (providers.length > MAX_AI_PROVIDERS) return { ok: false, error: `Choose at most ${MAX_AI_PROVIDERS} AI providers.`, field: "provider_0" };

  const models: Record<string, string> = {};
  for (const [i, id] of providers.entries()) {
    const def = getProvider(id);
    const name = def?.name ?? id;
    const field = `provider_${i}`;
    if (input.disabled.has(id)) return { ok: false, error: `${name} is disabled for this workspace. Enable it first.`, field };
    if (!input.keys.has(id)) return { ok: false, error: `${name} is not connected. Save and test your ${name} API key first.`, field };
    if (input.freeMode && def?.pricing === "paid") {
      return { ok: false, error: `${name} is a paid provider and cannot be used in Free Mode (including as a fallback).`, field };
    }
    const model = (input.models[id] ?? "").trim();
    if (model && !MODEL_PATTERN.test(model)) return { ok: false, error: "Model ids use letters, numbers and . _ : / @ - only.", field: `model_${id}` };
    if (!model && !MODEL_OPTIONAL.has(id)) return { ok: false, error: `Choose a ${name} model (run Test connection to list them).`, field: `model_${id}` };
    if (model) models[id] = model;
  }
  return { ok: true, providers, models };
}

export function resolveScenePlan(input: {
  settings: GenerationSettings;
  /** Provider the user picked for this render; must be one of the configured providers. */
  primary?: string | null;
  /** Providers the user has a saved key for. */
  keys: ReadonlySet<string>;
  /** Providers the workspace explicitly disabled. */
  disabled: ReadonlySet<string>;
}): ResolvedPlan {
  const { settings, keys, disabled } = input;
  const excluded: ExcludedProvider[] = [];
  const configured = settings.aiProviders.filter(isLlmProvider);

  if (input.primary && !configured.includes(input.primary)) {
    return { ok: false, error: "That AI provider is not configured for this workspace.", excluded };
  }
  const ordered = input.primary ? [input.primary, ...configured.filter((p) => p !== input.primary)] : configured;

  const providers: PlannedProvider[] = [];
  for (const id of ordered) {
    const def = getProvider(id);
    if (!def) continue;
    const paid = def.pricing === "paid";
    const model = settings.aiModels[id] ?? null;
    if (disabled.has(id)) excluded.push({ id, reason: `${def.name} is disabled for this workspace.` });
    else if (settings.freeMode && paid) excluded.push({ id, reason: `${def.name} is a paid provider and Free Mode is on.` });
    else if (!keys.has(id)) excluded.push({ id, reason: `No ${def.name} API key is saved for your account.` });
    else if (!model && !MODEL_OPTIONAL.has(id)) excluded.push({ id, reason: `Choose a ${def.name} model in Integrations.` });
    else providers.push({ id, model, paid });
  }

  if (input.primary && providers[0]?.id !== input.primary) {
    const why = excluded.find((e) => e.id === input.primary)?.reason ?? "It is not available.";
    return { ok: false, error: `Can't use ${getProvider(input.primary)?.name ?? input.primary}: ${why}`, excluded };
  }
  if (providers.length === 0) {
    return {
      ok: false,
      error: settings.freeMode
        ? "No free-tier AI provider is available. Add a key for a free-tier provider or turn off Free Mode."
        : "No AI provider is available. Add an API key in Integrations.",
      excluded,
    };
  }
  return { ok: true, providers, usesPaid: providers.some((p) => p.paid), excluded };
}

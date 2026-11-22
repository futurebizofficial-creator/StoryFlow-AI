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
}

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  freeMode: false,
  aiProviders: ["anthropic"],
  aiModels: {},
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

export function normalizeSettings(row: unknown): GenerationSettings {
  if (!row || typeof row !== "object") return { ...DEFAULT_GENERATION_SETTINGS };
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
    aiProviders: providers.length ? providers.slice(0, MAX_AI_PROVIDERS) : [...DEFAULT_GENERATION_SETTINGS.aiProviders],
    aiModels: models,
  };
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

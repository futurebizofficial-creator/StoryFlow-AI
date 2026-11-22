"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { encryptSecret, decryptSecret } from "@/lib/video/crypto";
import { getProvider, isKeyProvider, PROVIDERS } from "@/lib/integrations/catalog";
import { MAX_AI_PROVIDERS, MODEL_PATTERN, modelAvailability, validateGenerationSettings } from "@/lib/integrations/plan";
import { listGenerationModels, testModelGeneration, type ModelListResult, type ModelTestResult } from "@/lib/integrations/model-check";
import { testProviderConnection, type TestResult } from "@/lib/integrations/testers";
import type { ActionState } from "@/lib/types";

function refresh() {
  revalidatePath("/settings/integrations");
  revalidatePath("/video-studio");
}

/** Saves the caller's own key for a provider, encrypted with the existing AES-256-GCM envelope. */
export async function saveProviderKeyAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext();
  const provider = String(formData.get("provider") ?? "");
  if (!isKeyProvider(provider)) return { error: "This provider does not use an API key." };
  const secret = String(formData.get("apiKey") ?? "").trim();
  if (secret.length < 8 || secret.length > 500 || /[\s\u0000-\u001f]/.test(secret)) {
    return { fieldErrors: { apiKey: "Enter a valid API key (8–500 characters, no spaces)." } };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("workspace_provider_credentials").upsert(
    { workspace_id: ctx.current.workspace.id, user_id: ctx.user.id, provider, ...encryptSecret(secret) },
    { onConflict: "workspace_id,user_id,provider" },
  );
  if (error) return { error: `Could not save the key: ${error.message}` };
  refresh();
  return { success: `${getProvider(provider)?.name} key saved and encrypted.` };
}

/** Deletes the caller's own key (RLS limits this to their row in this workspace). */
export async function removeProviderKeyAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext();
  const provider = String(formData.get("provider") ?? "");
  if (!isKeyProvider(provider)) return { error: "Unknown provider." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("workspace_provider_credentials")
    .delete()
    .eq("workspace_id", ctx.current.workspace.id)
    .eq("user_id", ctx.user.id)
    .eq("provider", provider);
  if (error) return { error: `Could not remove the key: ${error.message}` };
  refresh();
  return { success: "Key removed." };
}

/** Tests a provider with the caller's own key using a free, read-only endpoint. */
export async function testProviderAction(provider: string): Promise<TestResult> {
  const ctx = await getWorkspaceContext();
  const def = getProvider(provider);
  if (!def || def.status !== "available") return { ok: false, message: "This provider cannot be tested." };
  let key: string | null = null;
  if (def.auth === "api_key") {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("workspace_provider_credentials")
      .select("ciphertext,nonce,auth_tag")
      .eq("workspace_id", ctx.current.workspace.id)
      .eq("user_id", ctx.user.id)
      .eq("provider", provider)
      .maybeSingle();
    if (error) return { ok: false, message: `Could not read the saved key: ${error.message}` };
    if (!data) return { ok: false, message: "Save an API key first." };
    try {
      key = decryptSecret(data);
    } catch {
      return { ok: false, message: "The saved key could not be decrypted. Save it again." };
    }
  }
  return testProviderConnection(provider, key);
}

/** Owners/admins enable or disable a provider for the whole workspace. */
export async function setProviderEnabledAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext();
  if (!ctx.canManage) return { error: "Only owners and admins can enable or disable providers." };
  const provider = String(formData.get("provider") ?? "");
  if (!PROVIDERS.some((p) => p.id === provider)) return { error: "Unknown provider." };
  const enabled = formData.get("enabled") === "true";
  const supabase = await createClient();
  const { error } = await supabase
    .from("workspace_integrations")
    .upsert({ workspace_id: ctx.current.workspace.id, provider, enabled, updated_by: ctx.user.id }, { onConflict: "workspace_id,provider" });
  if (error) return { error: `Could not update the provider: ${error.message}` };
  refresh();
  return { success: enabled ? "Enabled for this workspace." : "Disabled for this workspace." };
}

/** Owners/admins configure Free Mode, scene-planning provider order and models. */
export async function saveGenerationSettingsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext();
  if (!ctx.canManage) return { error: "Only owners and admins can change generation settings." };

  const freeMode = formData.get("freeMode") === "true";
  const providers = Array.from({ length: MAX_AI_PROVIDERS }, (_, i) => String(formData.get(`provider_${i}`) ?? ""));
  const models: Record<string, string> = {};
  for (const id of providers) if (id) models[id] = String(formData.get(`model_${id}`) ?? "");

  const supabase = await createClient();
  const wsId = ctx.current.workspace.id;
  const [keysRes, disabledRes] = await Promise.all([
    supabase.from("workspace_provider_credentials").select("provider").eq("workspace_id", wsId).eq("user_id", ctx.user.id),
    supabase.from("workspace_integrations").select("provider").eq("workspace_id", wsId).eq("enabled", false),
  ]);
  if (keysRes.error || disabledRes.error) {
    return { error: `Could not check provider connections: ${(keysRes.error ?? disabledRes.error)?.message}` };
  }
  const checked = validateGenerationSettings({
    freeMode,
    providers,
    models,
    keys: new Set((keysRes.data ?? []).map((r) => r.provider)),
    disabled: new Set((disabledRes.data ?? []).map((r) => r.provider)),
  });
  if (!checked.ok) return checked.field ? { error: checked.error, fieldErrors: { [checked.field]: checked.error } } : { error: checked.error };

  // Every chosen model must be in the provider's live list for the saver's key (no guessed or
  // retired model ids such as one that returns 404 at generation time).
  for (const [id, model] of Object.entries(checked.models)) {
    const name = getProvider(id)?.name ?? id;
    const { key, error: keyError } = await readOwnKey(id);
    if (!key) return { error: `Could not verify the ${name} model: ${keyError}`, fieldErrors: { [`model_${id}`]: keyError ?? "No key." } };
    const live = await listGenerationModels(id, key);
    if (!live.ok) {
      const msg = `Could not load ${name} models to verify "${model}": ${live.error}`;
      return { error: msg, fieldErrors: { [`model_${id}`]: msg } };
    }
    const availability = modelAvailability(id, model, live.models);
    if (!availability.ok) return { error: availability.message ?? "Model unavailable.", fieldErrors: { [`model_${id}`]: availability.message ?? "" } };
    checked.models[id] = availability.model;
  }

  const { error } = await supabase.from("workspace_generation_settings").upsert(
    { workspace_id: wsId, free_mode: freeMode, ai_providers: checked.providers, ai_models: checked.models, updated_by: ctx.user.id },
    { onConflict: "workspace_id" },
  );
  if (error) return { error: `Could not save generation settings: ${error.message}` };
  refresh();
  return { success: "Generation settings saved." };
}

async function readOwnKey(provider: string): Promise<{ key: string | null; error?: string }> {
  const ctx = await getWorkspaceContext();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_provider_credentials")
    .select("ciphertext,nonce,auth_tag")
    .eq("workspace_id", ctx.current.workspace.id)
    .eq("user_id", ctx.user.id)
    .eq("provider", provider)
    .maybeSingle();
  if (error) return { key: null, error: `Could not read the saved key: ${error.message}` };
  if (!data) return { key: null, error: "Save and test an API key first." };
  try {
    return { key: decryptSecret(data) };
  } catch {
    return { key: null, error: "The saved key could not be decrypted. Save it again." };
  }
}

/** Live model list (text-generation capable) for the model selector, using the caller's key. */
export async function listProviderModelsAction(provider: string): Promise<ModelListResult> {
  if (!getProvider(provider)?.llm) return { ok: false, models: [], error: "Not a language-model provider." };
  const { key, error } = await readOwnKey(provider);
  if (!key) return { ok: false, models: [], error };
  return listGenerationModels(provider, key);
}

/** One minimal generation request against the selected model (only when the user clicks Test model). */
export async function testProviderModelAction(provider: string, model: string): Promise<ModelTestResult> {
  const trimmed = String(model ?? "").trim();
  if (!getProvider(provider)?.llm) return { ok: false, model: trimmed, message: "Not a language-model provider." };
  if (!MODEL_PATTERN.test(trimmed)) return { ok: false, model: trimmed, message: "Choose a model first." };
  const { key, error } = await readOwnKey(provider);
  if (!key) return { ok: false, model: trimmed, message: error ?? "No key." };
  return testModelGeneration(provider, trimmed, key);
}

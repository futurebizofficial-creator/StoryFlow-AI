"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { encryptSecret, decryptSecret } from "@/lib/video/crypto";
import { getProvider, isKeyProvider, isLlmProvider, PROVIDERS } from "@/lib/integrations/catalog";
import { MAX_AI_PROVIDERS, MODEL_PATTERN } from "@/lib/integrations/plan";
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
  if (error) return { error: "Could not save the key. Please try again." };
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
  if (error) return { error: "Could not remove the key." };
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
    const { data } = await supabase
      .from("workspace_provider_credentials")
      .select("ciphertext,nonce,auth_tag")
      .eq("workspace_id", ctx.current.workspace.id)
      .eq("user_id", ctx.user.id)
      .eq("provider", provider)
      .maybeSingle();
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
  if (error) return { error: "Could not update the provider." };
  refresh();
  return { success: enabled ? "Enabled for this workspace." : "Disabled for this workspace." };
}

/** Owners/admins configure Free Mode, scene-planning provider order and models. */
export async function saveGenerationSettingsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext();
  if (!ctx.canManage) return { error: "Only owners and admins can change generation settings." };

  const freeMode = formData.get("freeMode") === "true";
  const order: string[] = [];
  for (let i = 0; i < MAX_AI_PROVIDERS; i++) {
    const id = String(formData.get(`provider_${i}`) ?? "");
    if (!id) continue;
    if (!isLlmProvider(id)) return { error: "Choose valid AI providers." };
    if (!order.includes(id)) order.push(id);
  }
  if (order.length === 0) return { fieldErrors: { provider_0: "Choose at least one AI provider." } };

  const models: Record<string, string> = {};
  for (const id of order) {
    const model = String(formData.get(`model_${id}`) ?? "").trim();
    if (!model) continue;
    if (!MODEL_PATTERN.test(model)) return { fieldErrors: { [`model_${id}`]: "Model ids use letters, numbers and . _ : / @ - only." } };
    models[id] = model;
  }
  if (freeMode && order.every((id) => getProvider(id)?.pricing === "paid")) {
    return { error: "Free Mode needs at least one free-tier AI provider in the list." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("workspace_generation_settings").upsert(
    { workspace_id: ctx.current.workspace.id, free_mode: freeMode, ai_providers: order, ai_models: models, updated_by: ctx.user.id },
    { onConflict: "workspace_id" },
  );
  if (error) return { error: "Could not save generation settings." };
  refresh();
  return { success: "Generation settings saved." };
}

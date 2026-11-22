"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { isUuid } from "@/lib/utils";
import { VIDEO_SCRIPT_MAX, VIDEO_SCRIPT_MIN, VIDEO_TONES } from "@/lib/video/status";
import { parseRenderSettings } from "@/lib/video/render-settings";
import { modelAvailability, normalizeModel, normalizeSettings, resolveScenePlan } from "@/lib/integrations/plan";
import { listGenerationModels } from "@/lib/integrations/model-check";
import { decryptSecret } from "@/lib/video/crypto";
import type { ActionState, VideoJobRequest } from "@/lib/types";

type QueueResult = { id: string } | { error: string; field?: string };

/**
 * Validates a render request and inserts a queued video job. Only settings the worker
 * forwards to Automated Video Generator are accepted (orientation, voice, subtitles,
 * background music) plus tone for scene planning; duration comes from the script.
 * Status, progress and output fields stay worker-owned.
 */
async function queueVideoJob(formData: FormData, mode: "studio" | "quick"): Promise<QueueResult> {
  const ctx = await getWorkspaceContext();
  const scriptId = formData.get("scriptId");
  if (!isUuid(scriptId)) return { error: "Choose a script to render.", field: "scriptId" };

  const orientation = String(formData.get("orientation") ?? "portrait");
  if (orientation !== "portrait" && orientation !== "landscape") {
    return { error: "Choose a valid video orientation.", field: "orientation" };
  }
  const parsed = parseRenderSettings((key) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : null;
  });
  if (!parsed.ok) return { error: parsed.error, field: parsed.field };
  const toneRaw = formData.get("tone");
  const tone = toneRaw === null || toneRaw === "" ? null : String(toneRaw);
  if (tone !== null && !VIDEO_TONES.includes(tone)) return { error: "Choose a valid tone.", field: "tone" };

  const supabase = await createClient();
  const { data: script, error: scriptError } = await supabase
    .from("scripts")
    .select("id,title,content,tone,target_duration_seconds")
    .eq("id", scriptId)
    .eq("workspace_id", ctx.current.workspace.id)
    .maybeSingle();
  if (scriptError) return { error: scriptError.message };
  if (!script) return { error: "That script is no longer available.", field: "scriptId" };
  if (script.content.trim().length < VIDEO_SCRIPT_MIN) {
    return { error: `Save a script with at least ${VIDEO_SCRIPT_MIN} characters before rendering.`, field: "scriptId" };
  }
  if (script.content.length > VIDEO_SCRIPT_MAX) {
    return { error: "The video engine accepts scripts up to 4,900 characters. Shorten the script before rendering.", field: "scriptId" };
  }

  // AI provider plan. Workspaces that never configured generation settings keep the original
  // behaviour (Claude) for quick renders; everything else follows the workspace plan, Free Mode
  // and explicit paid-usage confirmation.
  const [{ data: settingsRow, error: settingsError }, { data: keyRows, error: keysError }, { data: disabledRows, error: disabledError }] = await Promise.all([
    supabase.from("workspace_generation_settings").select("free_mode, ai_providers, ai_models").eq("workspace_id", ctx.current.workspace.id).maybeSingle(),
    supabase.from("workspace_provider_credentials").select("provider").eq("workspace_id", ctx.current.workspace.id).eq("user_id", ctx.user.id),
    supabase.from("workspace_integrations").select("provider").eq("workspace_id", ctx.current.workspace.id).eq("enabled", false),
  ]);
  // Never treat an unreadable settings row as "not configured": that would silently fall back
  // to Claude (paid) instead of the provider the workspace actually saved.
  const readError = settingsError ?? keysError ?? disabledError;
  if (readError) return { error: `Could not load AI provider settings: ${readError.message}`, field: "aiProvider" };

  // Production Setup: Studio renders run only with an approved setup. The character reference
  // task can be skipped (saves Gemini quota); quick renders keep the original behaviour (on).
  const refRaw = formData.get("characterReference");
  if (refRaw !== null && refRaw !== "on" && refRaw !== "off") return { error: "Choose a valid character reference option.", field: "aiProvider" };
  const characterReference = refRaw !== "off";
  if (mode === "studio" && formData.get("productionApproved") !== "true") {
    return { error: "Review and approve the Production Setup before generating.", field: "productionApproved" };
  }
  if (characterReference && !(keyRows ?? []).some((r) => r.provider === "gemini")) {
    return { error: "The character reference uses Google Gemini, but no Gemini key is saved. Connect Gemini or skip the character reference.", field: "aiProvider" };
  }
  let ai: VideoJobRequest["ai"];
  if (mode === "studio" || settingsRow) {
    const settings = normalizeSettings(settingsRow);
    const primaryRaw = mode === "studio" ? String(formData.get("aiProvider") ?? "") : "";
    const plan = resolveScenePlan({
      settings,
      primary: primaryRaw || null,
      keys: new Set((keyRows ?? []).map((r) => r.provider)),
      disabled: new Set((disabledRows ?? []).map((r) => r.provider)),
    });
    if (!plan.ok) return { error: plan.error, field: "aiProvider" };
    const acknowledged = formData.get("paidAcknowledged") === "true";
    if (plan.usesPaid && !acknowledged) {
      return mode === "studio"
        ? { error: "This render can use a paid AI provider. Confirm paid usage to continue.", field: "paidAcknowledged" }
        : { error: "This workspace's AI providers include a paid provider. Use AI Video Studio to confirm paid usage." };
    }
    // Verify each planned model against the provider's live list for this user's key before
    // queueing, so a retired or unsupported model fails here with a clear message instead of a
    // 404 inside the worker. If a list cannot be fetched (e.g. network), the worker still reports
    // the exact provider error.
    const providers: Array<{ id: string; model: string | null }> = [];
    for (const p of plan.providers) {
      if (!p.model) {
        providers.push({ id: p.id, model: null });
        continue;
      }
      const model = normalizeModel(p.id, p.model);
      const { data: cred } = await supabase
        .from("workspace_provider_credentials")
        .select("ciphertext,nonce,auth_tag")
        .eq("workspace_id", ctx.current.workspace.id)
        .eq("user_id", ctx.user.id)
        .eq("provider", p.id)
        .maybeSingle();
      if (cred) {
        let key: string | null = null;
        try {
          key = decryptSecret(cred);
        } catch {}
        if (key) {
          const live = await listGenerationModels(p.id, key);
          if (live.ok) {
            const availability = modelAvailability(p.id, model, live.models);
            if (!availability.ok) return { error: `${availability.message} Update it in Integrations.`, field: "aiProvider" };
          }
        }
      }
      providers.push({ id: p.id, model });
    }
    ai = {
      providers,
      freeMode: settings.freeMode,
      paidAcknowledged: plan.usesPaid,
    };
  }

  const request: VideoJobRequest = {
    title: script.title.slice(0, 160) || "Untitled video",
    script: script.content,
    targetDuration: script.target_duration_seconds,
    orientation,
    tone: tone ?? (VIDEO_TONES.includes(script.tone) ? script.tone : "conversational"),
    ...parsed.settings,
    ...(ai ? { ai } : {}),
    ...(mode === "studio" ? { characterReference, setupApprovedAt: new Date().toISOString() } : {}),
  };

  const { data, error } = await supabase
    .from("video_jobs")
    .insert({ workspace_id: ctx.current.workspace.id, script_id: script.id, created_by: ctx.user.id, request })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidatePath(`/studio/${script.id}`);
  revalidatePath("/videos");
  revalidatePath("/dashboard");
  return { id: data.id };
}

/** Legacy form action used by the render panel in the script editor. */
export async function enqueueVideoAction(formData: FormData) {
  const result = await queueVideoJob(formData, "quick");
  if ("error" in result) throw new Error(result.error);
}

/** AI Video Studio: queue a job and open its detail page, or return a form error. */
export async function generateVideoAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const result = await queueVideoJob(formData, "studio");
  if ("error" in result) {
    return result.field ? { error: result.error, fieldErrors: { [result.field]: result.error } } : { error: result.error };
  }
  redirect(`/videos/${result.id}?queued=1`);
}

export async function disconnectDriveAction() {
  const ctx = await getWorkspaceContext();
  const supabase = await createClient();
  const { error } = await supabase.from("google_drive_connections").delete().eq("user_id", ctx.user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/integrations");
}

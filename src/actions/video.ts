"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { isUuid } from "@/lib/utils";
import { encryptSecret } from "@/lib/video/crypto";
import { VIDEO_SCRIPT_MAX, VIDEO_SCRIPT_MIN, VIDEO_TONES } from "@/lib/video/status";
import { parseRenderSettings } from "@/lib/video/render-settings";
import type { ActionState, VideoJobRequest } from "@/lib/types";

type QueueResult = { id: string } | { error: string; field?: string };

/**
 * Validates a render request and inserts a queued video job. Only settings the worker
 * forwards to Automated Video Generator are accepted (orientation, voice, subtitles,
 * background music) plus tone for scene planning; duration comes from the script.
 * Status, progress and output fields stay worker-owned.
 */
async function queueVideoJob(formData: FormData): Promise<QueueResult> {
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

  const request: VideoJobRequest = {
    title: script.title.slice(0, 160) || "Untitled video",
    script: script.content,
    targetDuration: script.target_duration_seconds,
    orientation,
    tone: tone ?? (VIDEO_TONES.includes(script.tone) ? script.tone : "conversational"),
    ...parsed.settings,
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
  const result = await queueVideoJob(formData);
  if ("error" in result) throw new Error(result.error);
}

/** AI Video Studio: queue a job and open its detail page, or return a form error. */
export async function generateVideoAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const result = await queueVideoJob(formData);
  if ("error" in result) {
    return result.field ? { error: result.error, fieldErrors: { [result.field]: result.error } } : { error: result.error };
  }
  redirect(`/videos/${result.id}?queued=1`);
}

export async function saveProviderCredentialAction(formData: FormData) {
  const ctx = await getWorkspaceContext();
  const provider = String(formData.get("provider") ?? "");
  if (provider !== "anthropic" && provider !== "gemini") throw new Error("Unsupported provider.");
  const secret = String(formData.get("apiKey") ?? "").trim();
  if (!secret || secret.length > 500) throw new Error("Enter a valid API key (maximum 500 characters).");
  const supabase = await createClient();
  const sealed = encryptSecret(secret);
  const { error } = await supabase.from("workspace_provider_credentials").upsert({
    workspace_id: ctx.current.workspace.id,
    user_id: ctx.user.id,
    provider,
    ...sealed,
  }, { onConflict: "workspace_id,user_id,provider" });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/integrations");
  revalidatePath("/video-studio");
}

export async function disconnectDriveAction() {
  const ctx = await getWorkspaceContext();
  const supabase = await createClient();
  const { error } = await supabase.from("google_drive_connections").delete().eq("user_id", ctx.user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/integrations");
}

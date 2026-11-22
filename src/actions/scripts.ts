"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { isUuid } from "@/lib/utils";
import type { ActionState, ScriptFormat, ScriptStatus } from "@/lib/types";

const FORMATS: ScriptFormat[] = ["short_form", "long_form", "ad", "explainer", "story"];
const STATUSES: ScriptStatus[] = ["draft", "in_review", "approved"];

export async function createScriptAction(formData: FormData) {
  const ctx = await getWorkspaceContext();
  const projectId = formData.get("projectId");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scripts")
    .insert({
      workspace_id: ctx.current.workspace.id,
      project_id: isUuid(projectId) ? projectId : null,
      title: "Untitled script",
      created_by: ctx.user.id,
      updated_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/studio");
  redirect(`/studio/${data.id}`);
}

export async function saveScriptAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext();
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Invalid script." };

  const title = String(formData.get("title") ?? "").trim() || "Untitled script";
  const content = String(formData.get("content") ?? "");
  const format = String(formData.get("format") ?? "short_form") as ScriptFormat;
  const status = String(formData.get("status") ?? "draft") as ScriptStatus;
  const tone = String(formData.get("tone") ?? "conversational").trim().slice(0, 40) || "conversational";
  const duration = Number(formData.get("targetDuration") ?? 60);
  const projectIdRaw = formData.get("projectId");

  if (title.length > 160) return { error: "Title must be 160 characters or fewer." };
  if (content.length > 100000) return { error: "Script exceeds the 100,000 character limit." };
  if (!FORMATS.includes(format) || !STATUSES.includes(status)) return { error: "Invalid script settings." };
  if (!Number.isFinite(duration) || duration < 5 || duration > 7200) {
    return { error: "Target duration must be between 5 seconds and 2 hours." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("scripts")
    .update({
      title,
      content,
      format,
      status,
      tone,
      target_duration_seconds: Math.round(duration),
      project_id: isUuid(projectIdRaw) ? projectIdRaw : null,
      updated_by: ctx.user.id,
    })
    .eq("id", id)
    .eq("workspace_id", ctx.current.workspace.id);
  if (error) return { error: error.message };

  revalidatePath("/studio", "layout");
  return { success: `Saved ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` };
}

export async function deleteScriptAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext();
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Invalid script." };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("scripts")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("workspace_id", ctx.current.workspace.id);
  if (error) return { error: error.message };
  if (!count) return { error: "Only admins or the script author can delete this script." };

  revalidatePath("/studio", "layout");
  redirect("/studio");
}

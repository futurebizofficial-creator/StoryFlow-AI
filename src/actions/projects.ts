"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { isUuid } from "@/lib/utils";
import type { ActionState, ProjectStatus } from "@/lib/types";

const STATUSES: ProjectStatus[] = ["draft", "in_progress", "review", "completed", "archived"];

function parseProject(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const status = String(formData.get("status") ?? "draft") as ProjectStatus;
  const fieldErrors: Record<string, string> = {};
  if (name.length < 1 || name.length > 120) fieldErrors.name = "Use between 1 and 120 characters.";
  if (description.length > 2000) fieldErrors.description = "Keep the description under 2000 characters.";
  if (!STATUSES.includes(status)) fieldErrors.status = "Choose a valid status.";
  return { name, description: description || null, status, fieldErrors };
}

export async function createProjectAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext();
  const { name, description, status, fieldErrors } = parseProject(formData);
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({
      workspace_id: ctx.current.workspace.id,
      name,
      description,
      status,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/projects");
  revalidatePath("/dashboard");
  redirect(`/projects/${data.id}`);
}

export async function updateProjectAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext();
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Invalid project." };
  const { name, description, status, fieldErrors } = parseProject(formData);
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ name, description, status })
    .eq("id", id)
    .eq("workspace_id", ctx.current.workspace.id);
  if (error) return { error: error.message };

  revalidatePath(`/projects/${id}`);
  revalidatePath("/projects");
  return { success: "Project saved." };
}

export async function deleteProjectAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext();
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Invalid project." };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("projects")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("workspace_id", ctx.current.workspace.id);
  if (error) return { error: error.message };
  if (!count) return { error: "Only admins or the project creator can delete this project." };

  revalidatePath("/projects");
  revalidatePath("/dashboard");
  redirect("/projects");
}

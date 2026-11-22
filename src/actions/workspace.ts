"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { getWorkspaceContext, WORKSPACE_COOKIE, workspaceCookieOptions } from "@/lib/workspace";
import { isUuid } from "@/lib/utils";
import type { ActionState } from "@/lib/types";

async function setActiveWorkspace(id: string) {
  (await cookies()).set(WORKSPACE_COOKIE, id, workspaceCookieOptions());
}

export async function createWorkspaceAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 64) {
    return { fieldErrors: { name: "Use between 2 and 64 characters." } };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_workspace", { _name: name });
  if (error || !data) return { error: error?.message ?? "Could not create workspace." };

  await setActiveWorkspace(data as string);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function switchWorkspaceAction(formData: FormData) {
  await requireUser();
  const id = formData.get("workspaceId");
  if (!isUuid(id)) return;

  // Only switch to workspaces the user actually belongs to (RLS-filtered read).
  const supabase = await createClient();
  const { data } = await supabase.from("workspaces").select("id").eq("id", id).maybeSingle();
  if (!data) return;

  await setActiveWorkspace(id);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function renameWorkspaceAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getWorkspaceContext();
  if (!ctx.canManage) return { error: "Only owners and admins can rename the workspace." };

  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 64) {
    return { fieldErrors: { name: "Use between 2 and 64 characters." } };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update({ name })
    .eq("id", ctx.current.workspace.id);
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { success: "Workspace renamed." };
}

export async function deleteWorkspaceAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getWorkspaceContext();
  if (ctx.role !== "owner") return { error: "Only owners can delete a workspace." };
  if (String(formData.get("confirm") ?? "").trim() !== ctx.current.workspace.name) {
    return { fieldErrors: { confirm: "Type the workspace name exactly to confirm." } };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("workspaces")
    .delete({ count: "exact" })
    .eq("id", ctx.current.workspace.id);
  if (error) return { error: error.message };
  if (!count) return { error: "Workspace could not be deleted." };

  (await cookies()).delete(WORKSPACE_COOKIE);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function updateProfileAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const fullName = String(formData.get("fullName") ?? "").trim();
  if (fullName.length < 2 || fullName.length > 120) {
    return { fieldErrors: { fullName: "Use between 2 and 120 characters." } };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { success: "Profile updated." };
}

export async function acceptInvitationAction(formData: FormData) {
  await requireUser();
  const token = formData.get("token");
  if (!isUuid(token)) redirect("/dashboard");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invitation", { _token: token });
  if (error || !data) {
    redirect(`/invite/${token}?error=${encodeURIComponent(error?.message ?? "Could not accept invitation.")}`);
  }

  await setActiveWorkspace(data as string);
  revalidatePath("/", "layout");
  redirect("/dashboard?joined=1");
}

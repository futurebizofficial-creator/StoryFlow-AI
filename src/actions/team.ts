"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { isUuid } from "@/lib/utils";
import type { ActionState, WorkspaceRole } from "@/lib/types";

const ROLES: WorkspaceRole[] = ["owner", "admin", "member"];

export async function inviteMemberAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext();
  // Invite-only access: only owners invite, and every invitation is a member invitation.
  // The database enforces the same rules (invitations_insert_owners, member-only check).
  if (ctx.role !== "owner") return { error: "Only the workspace owner can invite teammates." };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { fieldErrors: { email: "Enter a valid email address." } };
  }
  if (email === ctx.user.email.toLowerCase()) return { error: "You are already in this workspace." };

  const supabase = await createClient();
  const { error } = await supabase.from("workspace_invitations").insert({
    workspace_id: ctx.current.workspace.id,
    email,
    role: "member",
    invited_by: ctx.user.id,
  });

  if (error) {
    if (error.code === "23505") return { error: "There is already a pending invitation for this email." };
    return { error: error.message };
  }

  revalidatePath("/team");
  return { success: `Invitation created for ${email}. Share the invite link below.` };
}

export async function revokeInvitationAction(formData: FormData) {
  const ctx = await getWorkspaceContext();
  const id = formData.get("invitationId");
  if (ctx.role !== "owner" || !isUuid(id)) return;

  const supabase = await createClient();
  await supabase
    .from("workspace_invitations")
    .update({ status: "revoked" })
    .eq("id", id)
    .eq("workspace_id", ctx.current.workspace.id);
  revalidatePath("/team");
}

export async function updateMemberRoleAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getWorkspaceContext();
  const userId = formData.get("userId");
  const role = String(formData.get("role") ?? "") as WorkspaceRole;
  if (!isUuid(userId) || !ROLES.includes(role)) return { error: "Invalid request." };
  if (ctx.role !== "owner") return { error: "Only owners can change roles." };
  if (role === "owner") return { error: "The owner role cannot be granted." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_member_role", {
    _workspace_id: ctx.current.workspace.id,
    _user_id: userId,
    _role: role,
  });
  if (error) return { error: error.message };

  revalidatePath("/team");
  return { success: "Role updated." };
}

export async function removeMemberAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext();
  const userId = formData.get("userId");
  if (!isUuid(userId)) return { error: "Invalid request." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_member", {
    _workspace_id: ctx.current.workspace.id,
    _user_id: userId,
  });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { success: userId === ctx.user.id ? "You left the workspace." : "Member removed." };
}

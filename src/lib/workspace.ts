import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import type { Membership, Profile, WorkspaceRole } from "@/lib/types";

export const WORKSPACE_COOKIE = "sf_workspace";

export const getMemberships = cache(async (): Promise<Membership[]> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, workspace:workspaces(id, name, slug, created_at)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load workspaces: ${error.message}`);
  return ((data ?? []) as unknown as Membership[]).filter((m) => m.workspace);
});

export interface WorkspaceContext {
  user: { id: string; email: string };
  profile: Profile | null;
  memberships: Membership[];
  current: Membership;
  role: WorkspaceRole;
  canManage: boolean;
}

/**
 * Resolves the active workspace from the cookie, validated against the user's
 * actual memberships (RLS-filtered). Redirects to onboarding if none exist.
 */
export const getWorkspaceContext = cache(async (): Promise<WorkspaceContext> => {
  const user = await requireUser();
  const memberships = await getMemberships();
  if (memberships.length === 0) redirect("/onboarding");

  const cookieStore = await cookies();
  const selectedId = cookieStore.get(WORKSPACE_COOKIE)?.value;
  const current = memberships.find((m) => m.workspace.id === selectedId) ?? memberships[0];

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  return {
    user: { id: user.id, email: user.email ?? "" },
    profile: (profile as Profile | null) ?? null,
    memberships,
    current,
    role: current.role,
    canManage: current.role === "owner" || current.role === "admin",
  };
});

export function workspaceCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  };
}

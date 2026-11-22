import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Logo, Icon } from "@/components/icons";
import { Card } from "@/components/ui";
import { CreateWorkspaceForm } from "@/components/workspace-forms";
import { SetupRequired } from "@/components/setup-required";
import { ThemeToggle } from "@/components/theme-toggle";
import { acceptInvitationAction } from "@/actions/workspace";
import { signOutAction } from "@/actions/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { requireUser } from "@/lib/auth";
import { getMemberships } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/utils";
import type { WorkspaceRole } from "@/lib/types";

export const metadata: Metadata = { title: "Create a workspace" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  await connection();
  if (!isSupabaseConfigured()) return <SetupRequired />;

  const user = await requireUser();
  const { new: creatingAnother } = await searchParams;
  const memberships = await getMemberships();
  if (memberships.length > 0 && !creatingAnother) redirect("/dashboard");

  const supabase = await createClient();
  // Invite-only: only the platform owner may create workspaces (enforced by create_workspace()).
  const [{ data }, { data: ownerCheck }] = await Promise.all([
    supabase.rpc("my_pending_invitations"),
    supabase.rpc("is_platform_owner"),
  ]);
  const canCreate = ownerCheck === true;
  if (creatingAnother && !canCreate && memberships.length > 0) redirect("/dashboard");
  const invites = (data ?? []) as Array<{ token: string; workspace_name: string; role: WorkspaceRole; invited_by_name: string | null }>;

  return (
    <div className="glow min-h-dvh">
      <div className="flex items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <div className="flex items-center gap-3">
          <ThemeToggle />
          {memberships.length > 0 ? (
            <Link href="/dashboard" className="text-sm text-muted hover:text-fg">
              Cancel
            </Link>
          ) : (
            <form action={signOutAction}>
              <button className="text-sm text-muted hover:text-fg">Sign out</button>
            </form>
          )}
        </div>
      </div>

      <main className="mx-auto max-w-md px-4 pt-8 pb-16 sm:pt-16">
        <p className="text-xs font-medium tracking-wide text-accent uppercase">
          {memberships.length && canCreate ? "New workspace" : "Welcome to StoryFlow"}
        </p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight">
          {!canCreate ? "Join your workspace" : memberships.length ? "Create another workspace" : "Set up your workspace"}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {canCreate
            ? "Workspaces keep projects, scripts and teammates separate. You'll be the owner."
            : "StoryFlow is invite-only. Accept your invitation below to join the workspace."}
          <span className="block pt-1 text-xs">Signed in as {user.email}</span>
        </p>

        {invites.length > 0 && (
          <div className="mt-7 space-y-2">
            <p className="text-[13px] font-medium text-fg-2">You have pending invitations</p>
            {invites.map((inv) => (
              <Card key={inv.token} className="flex items-center gap-3 p-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                  <Icon name="mail" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{inv.workspace_name}</p>
                  <p className="truncate text-xs text-muted">
                    {ROLE_LABEL[inv.role]} · invited by {inv.invited_by_name ?? "a teammate"}
                  </p>
                </div>
                <form action={acceptInvitationAction}>
                  <input type="hidden" name="token" value={inv.token} />
                  <button className="h-8 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-fg hover:bg-accent-hover">
                    Join
                  </button>
                </form>
              </Card>
            ))}
            {canCreate && <p className="pt-3 text-center text-xs text-muted">or create your own</p>}
          </div>
        )}

        {canCreate ? (
          <Card className="mt-6 p-6">
            <CreateWorkspaceForm />
          </Card>
        ) : (
          invites.length === 0 && (
            <Card className="mt-7 p-6 text-sm text-muted">
              You don&apos;t have a pending invitation for {user.email}. Ask the workspace owner to invite this address,
              then open the invitation link.
            </Card>
          )
        )}
      </main>
    </div>
  );
}

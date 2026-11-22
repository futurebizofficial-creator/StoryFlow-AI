import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { getOrigin } from "@/lib/origin";
import { PageContainer } from "@/components/page";
import { Alert, Avatar, Card, CardHeader, PageHeader } from "@/components/ui";
import { RoleBadge } from "@/components/status";
import { CopyLinkButton, InviteForm, RemoveMemberButton, RoleSelect } from "@/components/team-forms";
import { revokeInvitationAction } from "@/actions/team";
import { formatDate, ROLE_LABEL } from "@/lib/utils";
import type { Invitation, Member, WorkspaceRole } from "@/lib/types";

export const metadata: Metadata = { title: "Team" };

const ROLE_ORDER: Record<WorkspaceRole, number> = { owner: 0, admin: 1, member: 2 };

const PERMISSIONS: Array<{ label: string; roles: WorkspaceRole[] }> = [
  { label: "Create & edit projects and scripts", roles: ["owner", "admin", "member"] },
  { label: "Delete any project or script", roles: ["owner", "admin"] },
  { label: "Invite members", roles: ["owner"] },
  { label: "Change member and admin roles", roles: ["owner"] },
  { label: "Change integration settings", roles: ["owner", "admin"] },
  { label: "Rename workspace", roles: ["owner", "admin"] },
  { label: "Delete workspace", roles: ["owner"] },
];

export default async function TeamPage() {
  const ctx = await getWorkspaceContext();
  const supabase = await createClient();
  const wsId = ctx.current.workspace.id;
  const isOwner = ctx.role === "owner";

  const [{ data: membersData, error }, { data: invitesData }, origin] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("user_id, role, created_at, profile:profiles(email, full_name, avatar_url)")
      .eq("workspace_id", wsId),
    isOwner
      ? supabase
          .from("workspace_invitations")
          .select("id, email, role, token, status, expires_at, created_at")
          .eq("workspace_id", wsId)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    getOrigin(),
  ]);

  const members = ((membersData ?? []) as unknown as Member[]).sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.created_at.localeCompare(b.created_at),
  );
  const invites = (invitesData ?? []) as Invitation[];
  const now = new Date();

  /** Which roles the current user may assign to a target (mirrors DB rules: owners only, never owner). */
  const assignable = (target: WorkspaceRole): WorkspaceRole[] | null =>
    isOwner && target !== "owner" ? ["admin", "member"] : null;
  const canRemove = (target: WorkspaceRole, self: boolean) =>
    self || ctx.role === "owner" || (ctx.role === "admin" && target === "member");

  return (
    <PageContainer>
      <PageHeader
        title="Team"
        description={`People with access to ${ctx.current.workspace.name}. Your role: ${ROLE_LABEL[ctx.role]}.`}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Members" description={`${members.length} ${members.length === 1 ? "person" : "people"}`} />
            {error ? (
              <p className="p-5 text-sm text-danger">Could not load members: {error.message}</p>
            ) : (
              <ul className="divide-y divide-border">
                {members.map((m) => {
                  const self = m.user_id === ctx.user.id;
                  const roles = !self ? assignable(m.role) : null;
                  const name = m.profile?.full_name || m.profile?.email?.split("@")[0] || "Unknown";
                  return (
                    <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                      <Avatar name={m.profile?.full_name || m.profile?.email} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {name} {self && <span className="font-normal text-muted">(you)</span>}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {m.profile?.email} · joined {formatDate(m.created_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {roles ? <RoleSelect userId={m.user_id} role={m.role} allowed={roles} /> : <RoleBadge role={m.role} />}
                        {canRemove(m.role, self) && <RemoveMemberButton userId={m.user_id} self={self} />}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {isOwner && (
            <Card>
              <CardHeader title="Pending invitations" description="Invite links expire after 7 days." />
              {invites.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted">No pending invitations.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {invites.map((inv) => {
                    const expired = new Date(inv.expires_at) < now;
                    return (
                      <li key={inv.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{inv.email}</p>
                          <p className="text-xs text-muted">
                            {ROLE_LABEL[inv.role]} · {expired ? "expired" : `expires ${formatDate(inv.expires_at)}`}
                          </p>
                        </div>
                        {!expired && <CopyLinkButton url={`${origin}/invite/${inv.token}`} />}
                        <form action={revokeInvitationAction}>
                          <input type="hidden" name="invitationId" value={inv.id} />
                          <button className="rounded-lg px-2 py-1 text-[12px] font-medium text-muted hover:bg-danger-soft hover:text-danger">
                            Revoke
                          </button>
                        </form>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {isOwner ? (
            <Card>
              <CardHeader title="Invite a teammate" description="Invitations are for Members only." />
              <div className="space-y-4 p-5">
                <InviteForm />
                <Alert tone="neutral">
                  StoryFlow is invite-only. Copy the link from the pending list and send it to the invitee — it is the
                  only way to create a new account. Links expire after 7 days. Automated invite emails are not configured.
                </Alert>
              </div>
            </Card>
          ) : (
            <Alert tone="neutral" title="Need to add someone?">
              Only the workspace owner can send invitations.
            </Alert>
          )}

          <Card>
            <CardHeader title="Role permissions" description="Enforced by database row-level security." />
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] tracking-wide text-muted uppercase">
                    <th className="px-5 py-2.5 font-medium">Capability</th>
                    {(["owner", "admin", "member"] as const).map((r) => (
                      <th key={r} className="px-2 py-2.5 text-center font-medium">{ROLE_LABEL[r]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {PERMISSIONS.map((p) => (
                    <tr key={p.label}>
                      <td className="px-5 py-2.5 text-fg-2">{p.label}</td>
                      {(["owner", "admin", "member"] as const).map((r) => (
                        <td key={r} className="px-2 py-2.5 text-center">
                          {p.roles.includes(r) ? <span className="text-success">●</span> : <span className="text-muted/50">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}

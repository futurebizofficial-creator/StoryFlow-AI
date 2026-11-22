import type { Metadata } from "next";
import { getWorkspaceContext } from "@/lib/workspace";
import { PageContainer } from "@/components/page";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { DeleteWorkspaceForm, ProfileForm, RenameWorkspaceForm } from "@/components/workspace-forms";
import { RoleBadge } from "@/components/status";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await getWorkspaceContext();
  const ws = ctx.current.workspace;

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title="Settings" description="Manage your profile and this workspace." />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Your profile" description="Visible to teammates in your workspaces." />
          <div className="p-5">
            <ProfileForm fullName={ctx.profile?.full_name ?? ""} email={ctx.user.email} />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Workspace"
            description={`Created ${formatDate(ws.created_at)} · ${ws.slug}`}
            action={<RoleBadge role={ctx.role} />}
          />
          <div className="p-5">
            <RenameWorkspaceForm name={ws.name} disabled={!ctx.canManage} />
            {!ctx.canManage && <p className="mt-3 text-xs text-muted">Only owners and admins can rename the workspace.</p>}
          </div>
        </Card>

        {ctx.role === "owner" && (
          <Card className="border-danger/30">
            <CardHeader
              title="Delete workspace"
              description="Permanently deletes all projects, scripts, invitations and settings in this workspace."
            />
            <div className="p-5">
              <DeleteWorkspaceForm name={ws.name} />
            </div>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}

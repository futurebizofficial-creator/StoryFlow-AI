import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { PageContainer } from "@/components/page";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ProjectStatusBadge, ScriptStatusBadge } from "@/components/status";
import { DeleteProjectForm, ProjectForm } from "@/components/project-forms";
import { SubmitButton } from "@/components/form";
import { createScriptAction } from "@/actions/scripts";
import { formatDate, isUuid, timeAgo } from "@/lib/utils";
import type { Project, Script } from "@/lib/types";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await getWorkspaceContext();
  const supabase = await createClient();

  const [{ data: project }, { data: scriptsData }] = await Promise.all([
    supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .eq("workspace_id", ctx.current.workspace.id)
      .maybeSingle(),
    supabase
      .from("scripts")
      .select("id, title, status, updated_at, content, target_duration_seconds")
      .eq("project_id", id)
      .eq("workspace_id", ctx.current.workspace.id)
      .order("updated_at", { ascending: false }),
  ]);

  if (!project) notFound();
  const p = project as Project;
  const scripts = (scriptsData ?? []) as Script[];
  const canDelete = ctx.canManage || p.created_by === ctx.user.id;

  return (
    <PageContainer>
      <Link href="/projects" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <Icon name="chevronLeft" size={14} /> Projects
      </Link>
      <PageHeader
        title={p.name}
        description={`Created ${formatDate(p.created_at)} · Updated ${timeAgo(p.updated_at)}`}
        actions={<ProjectStatusBadge status={p.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader
            title="Scripts"
            description="Drafts attached to this project"
            action={
              <form action={createScriptAction}>
                <input type="hidden" name="projectId" value={p.id} />
                <SubmitButton size="sm" pendingText="Creating…">
                  <Icon name="plus" /> New script
                </SubmitButton>
              </form>
            }
          />
          {scripts.length === 0 ? (
            <EmptyState icon="pen" title="No scripts yet" description="Create a script to start writing for this project." />
          ) : (
            <ul className="divide-y divide-border">
              {scripts.map((s) => {
                const words = s.content.trim() ? s.content.trim().split(/\s+/).length : 0;
                return (
                  <li key={s.id}>
                    <Link href={`/studio/${s.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-surface-2/60">
                      <Icon name="file" className="text-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{s.title}</p>
                        <p className="text-xs text-muted">
                          {words} words · {timeAgo(s.updated_at)}
                        </p>
                      </div>
                      <ScriptStatusBadge status={s.status} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <div className="p-5">
              <ProjectForm project={p} />
            </div>
          </Card>
          {canDelete && (
            <Card className="border-danger/30">
              <CardHeader title="Danger zone" />
              <div className="p-5">
                <DeleteProjectForm id={p.id} />
              </div>
            </Card>
          )}
        </div>
      </div>
    </PageContainer>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { PageContainer } from "@/components/page";
import { Alert, ButtonLink, Card, CardHeader, EmptyState } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { ProjectStatusBadge, ScriptStatusBadge } from "@/components/status";
import { acceptInvitationAction } from "@/actions/workspace";
import { createScriptAction } from "@/actions/scripts";
import { SubmitButton } from "@/components/form";
import { ROLE_LABEL, timeAgo } from "@/lib/utils";
import { AutoRefresh } from "@/components/auto-refresh";
import { JobRow, type JobRowData } from "@/components/video-ui";
import { VIDEO_JOB_LIST_COLUMNS, type VideoJobListItem } from "@/lib/video/jobs";
import { isActiveJob } from "@/lib/video/status";
import type { Project, Script, WorkspaceRole } from "@/lib/types";

export const metadata: Metadata = { title: "Overview" };

interface PendingInvite {
  token: string;
  workspace_name: string;
  role: WorkspaceRole;
  invited_by_name: string | null;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ joined?: string; password?: string }>;
}) {
  const ctx = await getWorkspaceContext();
  const params = await searchParams;
  const supabase = await createClient();
  const wsId = ctx.current.workspace.id;

  const videoCount = (status?: string[]) => {
    let q = supabase.from("video_jobs").select("id", { count: "exact", head: true }).eq("workspace_id", wsId);
    if (status) q = q.in("status", status);
    return q;
  };

  const [projectsRes, scriptsRes, projectCount, scriptCount, memberCount, integrationsRes, invitesRes, jobsRes, videosTotal, videosReady, videosActive, videosFailed] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, name, status, updated_at, description")
        .eq("workspace_id", wsId)
        .order("updated_at", { ascending: false })
        .limit(5),
      supabase
        .from("scripts")
        .select("id, title, status, updated_at, content, project_id")
        .eq("workspace_id", wsId)
        .order("updated_at", { ascending: false })
        .limit(5),
      supabase.from("projects").select("id", { count: "exact", head: true }).eq("workspace_id", wsId),
      supabase.from("scripts").select("id", { count: "exact", head: true }).eq("workspace_id", wsId),
      supabase.from("workspace_members").select("user_id", { count: "exact", head: true }).eq("workspace_id", wsId),
      supabase.from("workspace_integrations").select("provider").eq("workspace_id", wsId).eq("enabled", true),
      supabase.rpc("my_pending_invitations"),
      supabase.from("video_jobs").select(VIDEO_JOB_LIST_COLUMNS).eq("workspace_id", wsId).order("created_at", { ascending: false }).limit(5),
      videoCount(),
      videoCount(["completed"]),
      videoCount(["queued", "running"]),
      videoCount(["failed"]),
    ]);

  const projects = (projectsRes.data ?? []) as Project[];
  const scripts = (scriptsRes.data ?? []) as Script[];
  const invites = (invitesRes.data ?? []) as PendingInvite[];
  const jobs = (jobsRes.data ?? []) as unknown as VideoJobListItem[];
  const videoStats: Array<{ label: string; value: number; icon: IconName; href: string; tone: string }> = [
    { label: "Videos generated", value: videosTotal.count ?? 0, icon: "film", href: "/videos", tone: "text-accent" },
    { label: "Ready to watch", value: videosReady.count ?? 0, icon: "play", href: "/videos?status=completed", tone: "text-success" },
    { label: "In progress", value: videosActive.count ?? 0, icon: "sparkles", href: "/videos?status=active", tone: "text-accent-2" },
    { label: "Failed", value: videosFailed.count ?? 0, icon: "alert", href: "/videos?status=failed", tone: "text-danger" },
  ];
  const words = scripts.reduce((n, s) => n + (s.content.trim() ? s.content.trim().split(/\s+/).length : 0), 0);

  const firstName = (ctx.profile?.full_name ?? "").split(" ")[0] || ctx.user.email.split("@")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const stats: Array<{ label: string; value: number | string; icon: IconName; href: string }> = [
    { label: "Projects", value: projectCount.count ?? 0, icon: "folder", href: "/projects" },
    { label: "Scripts", value: scriptCount.count ?? 0, icon: "file", href: "/studio" },
    { label: "Team members", value: memberCount.count ?? 0, icon: "users", href: "/team" },
    { label: "Integrations enabled", value: integrationsRes.data?.length ?? 0, icon: "plug", href: "/settings/integrations" },
  ];

  const checklist = [
    { done: (projectCount.count ?? 0) > 0, label: "Create your first project", href: "/projects/new" },
    { done: (scriptCount.count ?? 0) > 0, label: "Draft a script in Script Studio", href: "/studio" },
    { done: (videosTotal.count ?? 0) > 0, label: "Generate your first video", href: "/video-studio" },
    { done: (memberCount.count ?? 0) > 1, label: "Invite a teammate", href: "/team" },
    { done: (integrationsRes.data?.length ?? 0) > 0, label: "Review integration settings", href: "/settings/integrations" },
  ];
  const completed = checklist.filter((c) => c.done).length;

  return (
    <PageContainer>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            {ctx.current.workspace.name} · {ROLE_LABEL[ctx.role]}
          </p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight sm:text-[32px]">
            {greeting}, <span className="font-display font-normal italic">{firstName}</span>
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/projects/new" variant="outline">
            <Icon name="folder" /> New project
          </ButtonLink>
          <form action={createScriptAction}>
            <SubmitButton variant="outline" pendingText="Creating…">
              <Icon name="pen" /> New script
            </SubmitButton>
          </form>
          <ButtonLink href="/video-studio">
            <Icon name="sparkles" /> Generate video
          </ButtonLink>
        </div>
      </div>

      <div className="space-y-3">
        {params.joined && <Alert tone="success" title="You joined the workspace">Welcome to {ctx.current.workspace.name}.</Alert>}
        {params.password && <Alert tone="success">Your password was updated.</Alert>}
        {invites.map((inv) => (
          <div
            key={inv.token}
            className="flex flex-wrap items-center gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3"
          >
            <Icon name="mail" className="text-accent" />
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-medium">{inv.invited_by_name ?? "A teammate"}</span> invited you to join{" "}
              <span className="font-medium">{inv.workspace_name}</span> as {ROLE_LABEL[inv.role].toLowerCase()}.
            </p>
            <form action={acceptInvitationAction}>
              <input type="hidden" name="token" value={inv.token} />
              <button type="submit" className="h-8 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-fg hover:bg-accent-hover">
                Accept invitation
              </button>
            </form>
          </div>
        ))}
      </div>

      <AutoRefresh active={jobs.some((j) => isActiveJob(j.status))} intervalMs={8000} />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {videoStats.map((s) => (
          <Link key={s.label} href={s.href} className="group">
            <Card className="relative overflow-hidden p-4 transition-colors group-hover:border-border-strong sm:p-5">
              <div className="flex items-center justify-between text-muted">
                <span className="text-[13px]">{s.label}</span>
                <Icon name={s.icon} className={s.tone} />
              </div>
              <p className="mt-3 text-[28px] font-semibold tracking-tight tabular-nums">{s.value}</p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="group">
            <Card className="flex items-center justify-between gap-3 px-4 py-3 transition-colors group-hover:border-border-strong">
              <span className="flex items-center gap-2 text-[13px] text-muted">
                <Icon name={s.icon} className="transition-colors group-hover:text-accent" />
                {s.label}
              </span>
              <span className="text-lg font-semibold tracking-tight tabular-nums">{s.value}</span>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Recent video jobs"
              description="Live status from the render pipeline"
              action={<Link href="/videos" className="text-[13px] font-medium text-accent hover:underline">My Videos</Link>}
            />
            {jobsRes.error ? (
              <p className="px-5 py-6 text-sm text-danger">Could not load video jobs: {jobsRes.error.message}</p>
            ) : jobs.length === 0 ? (
              <EmptyState
                icon="film"
                title="No videos yet"
                description="Choose a script in AI Video Studio to generate a narrated, captioned video."
                action={<ButtonLink href="/video-studio" size="sm"><Icon name="sparkles" /> Generate video</ButtonLink>}
              />
            ) : (
              <ul className="divide-y divide-border">
                {jobs.map((j) => (
                  <li key={j.id}>
                    <JobRow job={j as JobRowData} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Recent projects"
              description="Latest activity across the workspace"
              action={<Link href="/projects" className="text-[13px] font-medium text-accent hover:underline">View all</Link>}
            />
            {projects.length === 0 ? (
              <EmptyState
                icon="folder"
                title="No projects yet"
                description="Projects group the scripts and assets for a single video or campaign."
                action={<ButtonLink href="/projects/new" size="sm"><Icon name="plus" /> Create project</ButtonLink>}
              />
            ) : (
              <ul className="divide-y divide-border">
                {projects.map((p) => (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-surface-2/60">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
                        <Icon name="film" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <p className="truncate text-xs text-muted">Updated {timeAgo(p.updated_at)}</p>
                      </div>
                      <ProjectStatusBadge status={p.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Recent scripts"
              action={<Link href="/studio" className="text-[13px] font-medium text-accent hover:underline">Open studio</Link>}
            />
            {scripts.length === 0 ? (
              <EmptyState icon="pen" title="No scripts yet" description="Start a draft in Script Studio — it saves to this workspace." />
            ) : (
              <ul className="divide-y divide-border">
                {scripts.map((s) => (
                  <li key={s.id}>
                    <Link href={`/studio/${s.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-surface-2/60">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
                        <Icon name="file" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{s.title}</p>
                        <p className="truncate text-xs text-muted">
                          {s.content.trim() ? `${s.content.trim().split(/\s+/).length} words` : "Empty draft"} · {timeAgo(s.updated_at)}
                        </p>
                      </div>
                      <ScriptStatusBadge status={s.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Getting started</h2>
              <span className="text-xs text-muted tabular-nums">{completed}/{checklist.length}</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(completed / checklist.length) * 100}%` }} />
            </div>
            <ul className="mt-4 space-y-1">
              {checklist.map((c) => (
                <li key={c.label}>
                  <Link href={c.href} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-surface-2">
                    <span
                      className={`grid size-5 shrink-0 place-items-center rounded-full border ${c.done ? "border-transparent bg-success text-white" : "border-border-strong"}`}
                    >
                      {c.done && <Icon name="check" size={12} />}
                    </span>
                    <span className={c.done ? "text-muted line-through" : ""}>{c.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="relative overflow-hidden p-5">
            <div className="glow absolute inset-0 opacity-80" />
            <div className="relative">
              <Icon name="activity" className="text-accent" />
              <p className="mt-3 text-sm font-medium">Words in recent scripts</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{words.toLocaleString()}</p>
              <p className="mt-1 text-xs text-muted">≈ {Math.round(words / 150)} min of narration at 150 wpm</p>
            </div>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}

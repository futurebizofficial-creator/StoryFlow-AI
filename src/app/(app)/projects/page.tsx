import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { PageContainer } from "@/components/page";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ProjectStatusBadge } from "@/components/status";
import { cn, PROJECT_STATUS_LABEL, timeAgo } from "@/lib/utils";
import type { Project, ProjectStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Projects" };

const FILTERS: Array<{ value: "all" | ProjectStatus; label: string }> = [
  { value: "all", label: "All" },
  ...(Object.entries(PROJECT_STATUS_LABEL) as Array<[ProjectStatus, string]>).map(([value, label]) => ({ value, label })),
];

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const ctx = await getWorkspaceContext();
  const { status = "all", q = "" } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("projects")
    .select("id, name, description, status, updated_at, created_at, scripts(count)")
    .eq("workspace_id", ctx.current.workspace.id)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (status !== "all" && status in PROJECT_STATUS_LABEL) query = query.eq("status", status);
  const term = q.trim().slice(0, 80).replace(/[%_,()]/g, "");
  if (term) query = query.ilike("name", `%${term}%`);

  const { data, error } = await query;
  const projects = (data ?? []) as Array<Project & { scripts: Array<{ count: number }> }>;

  const hrefFor = (s: string) => {
    const p = new URLSearchParams();
    if (s !== "all") p.set("status", s);
    if (term) p.set("q", term);
    const qs = p.toString();
    return qs ? `/projects?${qs}` : "/projects";
  };

  return (
    <PageContainer>
      <PageHeader
        title="Projects"
        description={`Every video, campaign and series in ${ctx.current.workspace.name}.`}
        actions={
          <ButtonLink href="/projects/new">
            <Icon name="plus" /> New project
          </ButtonLink>
        }
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:pb-0">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={hrefFor(f.value)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors",
                status === f.value ? "bg-fg text-bg" : "text-fg-2 hover:bg-surface-2",
              )}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <form className="relative sm:w-64" action="/projects">
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input
            name="q"
            defaultValue={term}
            placeholder="Search projects"
            aria-label="Search projects"
            className="h-9 w-full rounded-[10px] border border-border bg-surface pr-3 pl-9 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-[var(--ring)]"
          />
        </form>
      </div>

      {error ? (
        <Card className="p-6 text-sm text-danger">Could not load projects: {error.message}</Card>
      ) : projects.length === 0 ? (
        <Card>
          <EmptyState
            icon="folder"
            title={term || status !== "all" ? "No matching projects" : "Create your first project"}
            description={
              term || status !== "all"
                ? "Try a different filter or search term."
                : "Projects organise scripts for a single video, campaign or series."
            }
            action={
              !term && status === "all" ? (
                <ButtonLink href="/projects/new" size="sm">
                  <Icon name="plus" /> New project
                </ButtonLink>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="group">
              <Card className="flex h-full flex-col p-5 transition-[border,transform] group-hover:-translate-y-0.5 group-hover:border-border-strong">
                <div className="flex items-start justify-between gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-accent-soft to-surface-2 text-accent">
                    <Icon name="film" size={18} />
                  </span>
                  <ProjectStatusBadge status={p.status} />
                </div>
                <h2 className="mt-4 line-clamp-1 text-[15px] font-semibold tracking-tight">{p.name}</h2>
                <p className="mt-1 line-clamp-2 min-h-10 text-[13px] text-muted">{p.description || "No description"}</p>
                <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="file" size={13} /> {p.scripts?.[0]?.count ?? 0} scripts
                  </span>
                  <span>Updated {timeAgo(p.updated_at)}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}

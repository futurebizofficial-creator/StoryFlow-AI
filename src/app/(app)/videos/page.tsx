import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { PageContainer } from "@/components/page";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { AutoRefresh } from "@/components/auto-refresh";
import { VideoProgress, VideoStatusBadge } from "@/components/video-ui";
import { posterFor, signArtifactUrls, thumbnailPath, VIDEO_JOB_LIST_COLUMNS, type VideoJobListItem } from "@/lib/video/jobs";
import { isActiveJob, stageLabel } from "@/lib/video/status";
import { cn, formatDate, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "My Videos" };

const FILTERS = [
  { value: "all", label: "All" },
  { value: "completed", label: "Ready" },
  { value: "active", label: "In progress" },
  { value: "failed", label: "Failed" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

export default async function VideosPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await getWorkspaceContext();
  const { status } = await searchParams;
  const filter: Filter = FILTERS.some((f) => f.value === status) ? (status as Filter) : "all";
  const supabase = await createClient();

  let query = supabase
    .from("video_jobs")
    .select(VIDEO_JOB_LIST_COLUMNS)
    .eq("workspace_id", ctx.current.workspace.id)
    .order("created_at", { ascending: false })
    .limit(120);
  if (filter === "completed" || filter === "failed") query = query.eq("status", filter);
  if (filter === "active") query = query.in("status", ["queued", "running"]);

  const { data, error } = await query;
  const jobs = (data ?? []) as unknown as VideoJobListItem[];
  const wsId = ctx.current.workspace.id;
  const completed = jobs.filter((j) => j.status === "completed");
  // AVG thumbnails first; the character reference is the fallback for older jobs.
  const posters = await signArtifactUrls(supabase, [
    ...completed.map((j) => thumbnailPath(wsId, j.id)),
    ...completed.map((j) => j.visual_reference_path),
  ]);

  return (
    <PageContainer>
      <AutoRefresh active={jobs.some((j) => isActiveJob(j.status))} />
      <PageHeader
        eyebrow="Library"
        title="My Videos"
        description={`Every video generated in ${ctx.current.workspace.name}. Files are private to workspace members.`}
        actions={
          <ButtonLink href="/video-studio">
            <Icon name="sparkles" /> Generate video
          </ButtonLink>
        }
      />

      <nav aria-label="Filter videos" className="mb-5 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value === "all" ? "/videos" : `/videos?status=${f.value}`}
            aria-current={filter === f.value ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
              filter === f.value ? "border-accent/50 bg-accent-soft text-accent" : "border-border text-fg-2 hover:bg-surface-2 hover:text-fg",
            )}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {error ? (
        <Card className="p-6 text-sm text-danger">Could not load videos: {error.message}</Card>
      ) : jobs.length === 0 ? (
        <Card>
          <EmptyState
            icon="film"
            title={filter === "all" ? "No videos yet" : "Nothing here"}
            description={
              filter === "all"
                ? "Pick a script in AI Video Studio and generate your first video. It will appear here while it renders."
                : "No videos match this filter."
            }
            action={
              filter === "all" ? (
                <ButtonLink href="/video-studio" size="sm">
                  <Icon name="sparkles" /> Open AI Video Studio
                </ButtonLink>
              ) : (
                <ButtonLink href="/videos" size="sm" variant="outline">Show all videos</ButtonLink>
              )
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {jobs.map((job) => {
            const poster = job.status === "completed" ? posterFor(posters, wsId, job) : undefined;
            const active = isActiveJob(job.status);
            return (
              <li key={job.id}>
                <Card className="group flex h-full flex-col overflow-hidden transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-border-strong">
                  <Link href={`/videos/${job.id}`} className="relative block aspect-video overflow-hidden bg-surface-2" aria-label={`Open ${job.title || "video"}`}>
                    {poster ? (
                      // Signed, short-lived storage URL; next/image optimisation is not used for private artifacts.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={poster} alt="" className="size-full object-cover opacity-90 transition-transform duration-500 group-hover:scale-[1.03]" />
                    ) : (
                      <div className="glow absolute inset-0 opacity-60" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-bg/80 via-transparent to-transparent" />
                    <div className="absolute inset-0 grid place-items-center">
                      {job.status === "completed" ? (
                        <span className="grid size-12 place-items-center rounded-full bg-white/15 text-white ring-1 ring-white/30 backdrop-blur-md transition-transform group-hover:scale-110">
                          <Icon name="play" size={20} />
                        </span>
                      ) : job.status === "failed" ? (
                        <Icon name="alert" size={26} className="text-danger" />
                      ) : (
                        <span className="size-8 animate-spin rounded-full border-2 border-accent border-r-transparent" aria-hidden="true" />
                      )}
                    </div>
                    <span className="absolute top-3 left-3"><VideoStatusBadge status={job.status} /></span>
                    {job.orientation && (
                      <span className="absolute top-3 right-3 rounded-md bg-black/40 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur">
                        {job.orientation === "landscape" ? "16:9" : "9:16"}
                      </span>
                    )}
                  </Link>
                  <div className="flex flex-1 flex-col gap-3 p-4">
                    <div className="min-w-0">
                      <Link href={`/videos/${job.id}`} className="block truncate text-sm font-semibold hover:text-accent">
                        {job.title || "Untitled video"}
                      </Link>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {job.status === "completed" && job.completed_at
                          ? `Completed ${formatDate(job.completed_at)}`
                          : `${stageLabel(job.stage, job.status)} · started ${timeAgo(job.created_at)}`}
                      </p>
                    </div>
                    {active && (
                      <div className="space-y-1">
                        <VideoProgress status={job.status} progress={job.progress} />
                        <p className="text-right text-[11px] text-muted tabular-nums">{job.progress}%</p>
                      </div>
                    )}
                    {job.status === "failed" && job.error && <p className="line-clamp-2 text-xs text-danger">{job.error}</p>}
                    {job.status === "completed" && (
                      <div className="mt-auto flex flex-wrap gap-2">
                        <a href={`/api/videos/${job.id}/download`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 text-[12px] font-medium hover:bg-surface-3">
                          <Icon name="download" size={13} /> MP4
                        </a>
                        {job.drive_file_url && (
                          <a href={job.drive_file_url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 text-[12px] font-medium hover:bg-surface-3">
                            <Icon name="external" size={13} /> Drive
                          </a>
                        )}
                        <Link href={`/videos/${job.id}`} className="ml-auto inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-accent hover:bg-accent-soft">
                          Details <Icon name="chevronRight" size={13} />
                        </Link>
                      </div>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </PageContainer>
  );
}

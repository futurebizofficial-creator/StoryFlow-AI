import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { PageContainer } from "@/components/page";
import { Alert, Card, CardHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { AutoRefresh } from "@/components/auto-refresh";
import { VideoProgress, VideoStatusBadge } from "@/components/video-ui";
import { RegenerateVideo } from "@/components/regenerate-video";
import { posterFor, signArtifactUrls, thumbnailPath } from "@/lib/video/jobs";
import { isActiveJob, PIPELINE_STEPS, pipelineStepIndex, stageLabel } from "@/lib/video/status";
import { cn, formatDuration, isUuid, timeAgo } from "@/lib/utils";
import type { VideoJob } from "@/lib/types";
import { settingsToFormEntries } from "@/lib/video/render-settings";

export const metadata: Metadata = { title: "Video" };

const linkButton =
  "inline-flex h-9 items-center gap-2 rounded-[10px] border border-border bg-surface-2 px-3.5 text-sm font-medium transition-colors hover:bg-surface-3";

export default async function VideoDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ queued?: string }>;
}) {
  const { id } = await params;
  const { queued } = await searchParams;
  if (!isUuid(id)) notFound();
  const ctx = await getWorkspaceContext();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("video_jobs")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", ctx.current.workspace.id)
    .maybeSingle();
  if (error) {
    return (
      <PageContainer>
        <Alert tone="danger" title="Could not load this video">{error.message}</Alert>
      </PageContainer>
    );
  }
  if (!data) notFound();
  const job = data as VideoJob;

  const completed = job.status === "completed";
  const [{ data: script }, videoUrls, urls] = await Promise.all([
    supabase.from("scripts").select("id,title").eq("id", job.script_id).eq("workspace_id", ctx.current.workspace.id).maybeSingle(),
    // The MP4 is signed on its own so an absent thumbnail (older jobs, or AVG produced none)
    // can never affect playback of a completed video.
    completed ? signArtifactUrls(supabase, [job.output_url]) : Promise.resolve(new Map<string, string>()),
    completed
      ? signArtifactUrls(supabase, [thumbnailPath(job.workspace_id, job.id), job.visual_reference_path])
      : Promise.resolve(new Map<string, string>()),
  ]);
  const videoUrl = job.output_url ? videoUrls.get(job.output_url) : undefined;
  const posterUrl = posterFor(urls, job.workspace_id, job);
  const referenceUrl = job.visual_reference_path ? urls.get(job.visual_reference_path) : undefined;
  const textConfig = job.request.showText === false ? undefined : job.request.textConfig;
  const subtitleSummary =
    job.request.showText === false
      ? "Off"
      : textConfig && Object.keys(textConfig).length
        ? [
            textConfig.position && `${textConfig.position}`,
            textConfig.animation && `${textConfig.animation} animation`,
            textConfig.background && `${textConfig.background} background`,
            textConfig.fontSize && `${textConfig.fontSize}px`,
            typeof textConfig.glow === "boolean" && (textConfig.glow ? "glow" : "no glow"),
          ]
            .filter(Boolean)
            .join(" · ") || "Custom"
        : "On · engine default style";
  const active = isActiveJob(job.status);
  const stepIndex = pipelineStepIndex(job.stage, job.status);
  const orientation = job.request.orientation === "landscape" ? "landscape" : "portrait";
  const title = job.request.title || "Untitled video";

  return (
    <PageContainer>
      <AutoRefresh active={active} intervalMs={4000} />

      <div className="mb-6 flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <Link href="/videos" className="inline-flex items-center gap-1 hover:text-fg">
          <Icon name="chevronLeft" size={14} /> My Videos
        </Link>
      </div>

      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <VideoStatusBadge status={job.status} />
            <span className="text-xs text-muted">Started {timeAgo(job.created_at)}</span>
          </div>
          <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        </div>
        {job.status === "completed" && (
          <div className="flex flex-wrap gap-2">
            <a href={`/api/videos/${job.id}/download`} className={cn(linkButton, "border-transparent bg-brand text-white hover:brightness-110")}>
              <Icon name="download" /> Download MP4
            </a>
            {job.drive_file_url && (
              <a href={job.drive_file_url} target="_blank" rel="noreferrer" className={linkButton}>
                <Icon name="external" /> Open in Drive
              </a>
            )}
          </div>
        )}
      </div>

      {queued && active && (
        <div className="mb-6">
          <Alert tone="success" title="Video queued">
            Generation has started. This page updates automatically — you can safely leave and come back.
          </Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          {/* Player / state */}
          <Card className="overflow-hidden">
            {job.status === "completed" && videoUrl ? (
              <div className="bg-black">
                <video
                  controls
                  playsInline
                  preload="metadata"
                  poster={posterUrl}
                  src={videoUrl}
                  aria-label={`${title} video`}
                  className={cn(
                    "mx-auto block bg-black object-contain",
                    orientation === "portrait" ? "aspect-[9/16] h-[70dvh] max-h-[760px] w-auto max-w-full" : "aspect-video w-full",
                  )}
                >
                  Your browser cannot play this video. Use Download MP4 instead.
                </video>
              </div>
            ) : job.status === "completed" ? (
              <div className="grid aspect-video place-items-center p-6 text-center">
                <div>
                  <Icon name="alert" size={22} className="mx-auto text-warning" />
                  <p className="mt-2 text-sm font-medium">Preview unavailable</p>
                  <p className="mt-1 text-xs text-muted">The file could not be signed for streaming. Try Download MP4.</p>
                </div>
              </div>
            ) : job.status === "failed" ? (
              <div className="grid aspect-video place-items-center bg-danger-soft/40 p-6 text-center">
                <div className="max-w-md">
                  <Icon name="alert" size={24} className="mx-auto text-danger" />
                  <p className="mt-2 text-sm font-semibold">Generation failed</p>
                  {job.error && <p className="mt-1 text-xs break-words text-fg-2">{job.error}</p>}
                </div>
              </div>
            ) : (
              <div className="relative grid aspect-video place-items-center overflow-hidden p-6 text-center">
                <div className="glow absolute inset-0" />
                <div className="relative w-full max-w-sm">
                  <span className="mx-auto block size-10 animate-spin rounded-full border-2 border-accent border-r-transparent" aria-hidden="true" />
                  <p className="mt-4 text-sm font-semibold">{stageLabel(job.stage, job.status)}</p>
                  <p className="mt-1 text-xs text-muted tabular-nums">{job.progress}% complete</p>
                  <VideoProgress status={job.status} progress={job.progress} className="mt-4" />
                </div>
              </div>
            )}
          </Card>

          {/* Quality report */}
          <Card>
            <CardHeader title="Quality report" description="Post-render analysis from the Agentic Video quality check." />
            <div className="p-5">
              {job.quality_report && typeof job.quality_report === "object" ? (
                <QualityReport value={job.quality_report as Record<string, unknown>} />
              ) : (
                <p className="text-sm text-muted">
                  {job.status === "completed"
                    ? "No quality report was produced for this video. The check runs only when the worker has the Agentic Video quality service configured."
                    : job.status === "failed"
                      ? "Not available for failed generations."
                      : "Available after rendering finishes."}
                </p>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Progress timeline */}
          <Card>
            <CardHeader title="Generation progress" />
            <ol className="space-y-0 p-5">
              {PIPELINE_STEPS.map((step, i) => {
                const failedHere = job.status === "failed";
                const done = job.status === "completed" || (!failedHere && i < stepIndex);
                const current = !failedHere && job.status !== "completed" && i === stepIndex;
                return (
                  <li key={step.key} className="relative flex gap-3 pb-5 last:pb-0">
                    {i < PIPELINE_STEPS.length - 1 && (
                      <span className={cn("absolute top-6 left-[11px] h-[calc(100%-1.25rem)] w-px", done ? "bg-success/60" : "bg-border")} aria-hidden="true" />
                    )}
                    <span
                      className={cn(
                        "relative grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                        done ? "bg-success text-white" : current ? "bg-brand text-white ring-4 ring-accent/20" : "bg-surface-3 text-muted",
                      )}
                    >
                      {done ? <Icon name="check" size={12} /> : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className={cn("block text-[13px] font-medium", !done && !current && "text-muted")}>{step.label}</span>
                      <span className="block text-xs text-muted">{current && step.key === "rendering" && job.stage !== "rendering" ? job.stage.replaceAll("_", " ") : step.detail}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
            {job.status === "failed" && (
              <p className="border-t border-border px-5 py-3 text-xs text-danger">Stopped after {job.attempts} attempt{job.attempts === 1 ? "" : "s"}.</p>
            )}
          </Card>

          {/* Settings */}
          <Card>
            <CardHeader title="Settings" />
            <dl className="divide-y divide-border text-[13px]">
              <Row label="Script" value={script ? <Link href={`/studio/${script.id}`} className="text-accent hover:underline">{script.title}</Link> : <span className="text-muted">Deleted</span>} />
              <Row label="Orientation" value={orientation === "landscape" ? "Landscape 16:9" : "Portrait 9:16"} />
              <Row label="Tone" value={job.request.tone ? job.request.tone[0].toUpperCase() + job.request.tone.slice(1) : "Conversational"} />
              <Row label="Voice" value={job.request.voice || <span className="text-muted">Engine default</span>} />
              <Row label="Subtitles" value={<span className="capitalize">{subtitleSummary}</span>} />
              {textConfig?.color && (
                <Row
                  label="Subtitle color"
                  value={
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                      <span className="size-3 rounded-sm border border-border" style={{ background: textConfig.color }} aria-hidden="true" />
                      {textConfig.color}
                    </span>
                  }
                />
              )}
              <Row label="Music" value={job.request.backgroundMusic || <span className="text-muted">Automatic</span>} />
              {job.request.targetDuration ? <Row label="Target length" value={formatDuration(job.request.targetDuration)} /> : null}
              <Row label="Attempts" value={String(job.attempts)} />
              {job.completed_at && <Row label="Finished" value={new Date(job.completed_at).toLocaleString()} />}
            </dl>
            {(job.status === "completed" && referenceUrl) || script ? (
              <div className="flex flex-wrap items-start gap-2 border-t border-border p-4">
                {job.status === "completed" && referenceUrl && (
                  <a href={`/api/videos/${job.id}/reference`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] font-medium hover:bg-surface-2">
                    <Icon name="image" size={13} /> Character reference
                  </a>
                )}
                {script && !active && (
                  <RegenerateVideo
                    scriptId={script.id}
                    orientation={orientation}
                    tone={job.request.tone}
                    settings={settingsToFormEntries(job.request)}
                    label={job.status === "failed" ? "Try again" : "Generate again"}
                  />
                )}
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/** Renders whatever the analyze.video plugin returned: scalar fields as a grid, nested data as JSON. */
function QualityReport({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value);
  const scalars = entries.filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v));
  const nested = entries.filter(([, v]) => v !== null && typeof v === "object");
  if (entries.length === 0) return <p className="text-sm text-muted">The quality check returned an empty report.</p>;
  return (
    <div className="space-y-4">
      {scalars.length > 0 && (
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {scalars.map(([k, v]) => (
            <div key={k} className="rounded-xl border border-border bg-surface-2/60 px-3.5 py-3">
              <dt className="truncate text-[11px] tracking-wide text-muted uppercase">{k.replace(/[_-]+/g, " ")}</dt>
              <dd className="mt-1 truncate text-sm font-semibold tabular-nums">{v === null ? "—" : formatValue(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {nested.map(([k, v]) => (
        <details key={k} className="rounded-xl border border-border bg-surface-2/40">
          <summary className="cursor-pointer px-3.5 py-2.5 text-[13px] font-medium capitalize">{k.replace(/[_-]+/g, " ")}</summary>
          <pre className="scrollbar-thin max-h-72 overflow-auto border-t border-border px-3.5 py-3 font-mono text-[11.5px] leading-relaxed text-fg-2">
            {JSON.stringify(v, null, 2).slice(0, 20000)}
          </pre>
        </details>
      ))}
    </div>
  );
}

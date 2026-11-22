import Link from "next/link";
import { Badge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { cn, timeAgo } from "@/lib/utils";
import { isActiveJob, stageLabel, VIDEO_STATUS_LABEL, VIDEO_STATUS_TONE } from "@/lib/video/status";
import type { VideoJobStatus } from "@/lib/types";

export function VideoStatusBadge({ status }: { status: VideoJobStatus }) {
  return (
    <Badge tone={VIDEO_STATUS_TONE[status] ?? "neutral"} dot>
      {VIDEO_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

export function VideoProgress({ status, progress, className }: { status: string; progress: number; className?: string }) {
  const active = isActiveJob(status);
  const value = status === "completed" ? 100 : Math.max(active ? 3 : 0, Math.min(100, progress));
  return (
    <div
      className={cn("h-1.5 overflow-hidden rounded-full bg-surface-3", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-label="Generation progress"
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-700",
          status === "failed" ? "bg-danger" : status === "completed" ? "bg-success" : active ? "progress-active" : "bg-accent",
        )}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

export interface JobRowData {
  id: string;
  status: VideoJobStatus;
  stage: string;
  progress: number;
  title: string | null;
  created_at: string;
  error: string | null;
}

/** Compact job row used on the dashboard and other lists. */
export function JobRow({ job }: { job: JobRowData }) {
  return (
    <Link href={`/videos/${job.id}`} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2/60">
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-xl",
          job.status === "completed" ? "bg-success-soft text-success" : job.status === "failed" ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent",
        )}
      >
        <Icon name={job.status === "failed" ? "alert" : job.status === "completed" ? "film" : "sparkles"} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{job.title || "Untitled video"}</p>
        <p className="truncate text-xs text-muted">
          {stageLabel(job.stage, job.status)}
          {isActiveJob(job.status) ? ` · ${job.progress}%` : ""} · {timeAgo(job.created_at)}
        </p>
        {isActiveJob(job.status) && <VideoProgress status={job.status} progress={job.progress} className="mt-2 max-w-60" />}
      </div>
      <VideoStatusBadge status={job.status} />
    </Link>
  );
}

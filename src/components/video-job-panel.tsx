"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { enqueueVideoAction } from "@/actions/video";
import { Card, Select } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { Icon } from "@/components/icons";
import { VideoProgress, VideoStatusBadge } from "@/components/video-ui";
import { stageLabel } from "@/lib/video/status";
import type { VideoJobStatus } from "@/lib/types";

type VideoJob = { id: string; status: string; stage: string; progress: number; output_url: string | null; drive_file_url?: string | null; error: string | null; created_at: string };

export function VideoJobPanel({ scriptId, jobs }: { scriptId: string; jobs: VideoJob[] }) {
  const router = useRouter();
  const hasActiveJob = jobs.some((job) => job.status === "queued" || job.status === "running");
  useEffect(() => {
    if (!hasActiveJob) return;
    const interval = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(interval);
  }, [hasActiveJob, router]);
  return (
    <section className="mx-auto w-full max-w-5xl space-y-3 px-4 pb-10 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Video renders</h2>
          <p className="text-xs text-muted">
            Quick render with default settings, or open{" "}
            <Link href={`/video-studio?script=${scriptId}`} className="font-medium text-accent hover:underline">AI Video Studio</Link> for voice and tone.
          </p>
        </div>
        <form action={enqueueVideoAction} className="flex items-center gap-2">
          <input type="hidden" name="scriptId" value={scriptId} />
          <Select name="orientation" aria-label="Video orientation" defaultValue="portrait">
            <option value="portrait">Portrait 9:16</option>
            <option value="landscape">Landscape 16:9</option>
          </Select>
          <SubmitButton pendingText="Queuing…">Render video</SubmitButton>
        </form>
      </div>
      {jobs.map((job) => (
        <Card key={job.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <VideoStatusBadge status={job.status as VideoJobStatus} />
              <Link href={`/videos/${job.id}`} className="font-medium hover:text-accent">
                {stageLabel(job.stage, job.status)}
                {job.status === "queued" || job.status === "running" ? ` · ${job.progress}%` : ""}
              </Link>
            </div>
            <p className="mt-1 text-xs text-muted">{new Date(job.created_at).toLocaleString()}</p>
            {(job.status === "queued" || job.status === "running") && <VideoProgress status={job.status} progress={job.progress} className="mt-2 max-w-72" />}
            {job.error && <p className="mt-1 text-xs text-danger">{job.error}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {job.status === "completed" && (
              <>
                <a className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs hover:bg-surface-2" href={`/api/videos/${job.id}/download`}>
                  <Icon name="download" size={13} /> MP4
                </a>
                {job.drive_file_url && (
                  <a className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs hover:bg-surface-2" href={job.drive_file_url} target="_blank" rel="noreferrer">
                    <Icon name="external" size={13} /> Drive
                  </a>
                )}
              </>
            )}
            <Link className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-medium text-accent hover:bg-accent-soft" href={`/videos/${job.id}`}>
              Details <Icon name="chevronRight" size={13} />
            </Link>
          </div>
        </Card>
      ))}
    </section>
  );
}

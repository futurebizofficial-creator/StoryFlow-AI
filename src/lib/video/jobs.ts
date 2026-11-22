import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const VIDEO_BUCKET = "storyflow-videos";

/** Columns needed for job lists (avoids loading the full script stored in request). */
export const VIDEO_JOB_LIST_COLUMNS =
  "id,script_id,status,stage,progress,error,output_url,visual_reference_path,drive_file_url,created_at,completed_at,title:request->>title,orientation:request->>orientation";

export interface VideoJobListItem {
  id: string;
  script_id: string;
  status: "queued" | "running" | "completed" | "failed";
  stage: string;
  progress: number;
  error: string | null;
  output_url: string | null;
  visual_reference_path: string | null;
  drive_file_url: string | null;
  created_at: string;
  completed_at: string | null;
  title: string | null;
  orientation: string | null;
}

/**
 * Fixed storage path where the worker saves Automated Video Generator's thumbnail.
 * Older jobs (and renders where AVG produced none) simply have no object here.
 */
export function thumbnailPath(workspaceId: string, jobId: string) {
  return `${workspaceId}/${jobId}/thumbnail.jpg`;
}

/** Signed poster for completed jobs: AVG thumbnail, else the Gemini character reference. */
export function posterFor(
  urls: Map<string, string>,
  workspaceId: string,
  job: { id: string; visual_reference_path: string | null },
) {
  return urls.get(thumbnailPath(workspaceId, job.id)) ?? (job.visual_reference_path ? urls.get(job.visual_reference_path) : undefined);
}

/**
 * Short-lived signed URLs for private workspace artifacts. Access is enforced by the
 * storage.objects RLS policy (workspace members only); paths the user cannot read are omitted.
 */
export async function signArtifactUrls(supabase: Supabase, paths: Array<string | null | undefined>, expiresIn = 3600) {
  const unique = Array.from(new Set(paths.filter((p): p is string => Boolean(p))));
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const { data, error } = await supabase.storage.from(VIDEO_BUCKET).createSignedUrls(unique, expiresIn);
  if (!error) {
    // Missing objects (e.g. no thumbnail for an older job) come back per path without a URL.
    for (const row of data ?? []) {
      if (row.path && row.signedUrl && !row.error) map.set(row.path, row.signedUrl);
    }
    return map;
  }
  // If the batch request itself fails, sign paths individually so one bad path cannot
  // hide the others.
  const single = await Promise.all(
    unique.map(async (path) => {
      const { data: one } = await supabase.storage.from(VIDEO_BUCKET).createSignedUrl(path, expiresIn);
      return [path, one?.signedUrl] as const;
    }),
  );
  for (const [path, url] of single) if (url) map.set(path, url);
  return map;
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";
import { isSupabaseConfigured } from "@/lib/env";

/** Safe ASCII download filename derived from the video title. */
function filenameFor(title: unknown, id: string) {
  const base = String(title ?? "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${base || "storyflow-video"}-${id.slice(0, 8)}.mp4`;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return new NextResponse("Not found", { status: 404 });
  if (!isSupabaseConfigured()) return new NextResponse("Video storage is not configured", { status: 503 });
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("video_jobs")
    .select("workspace_id,output_url,status,title:request->>title")
    .eq("id", id)
    .maybeSingle();
  if (!job || job.status !== "completed" || !job.output_url) return new NextResponse("Not found", { status: 404 });
  // RLS on video_jobs and storage.objects limits this to workspace members. The signed URL
  // expires after 60 seconds and asks the browser to save the file instead of playing it.
  const { data, error } = await supabase.storage
    .from("storyflow-videos")
    .createSignedUrl(job.output_url, 60, { download: filenameFor(job.title, id) });
  if (error || !data?.signedUrl) return new NextResponse("Video is unavailable", { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}

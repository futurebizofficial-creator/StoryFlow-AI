import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";
import { isSupabaseConfigured } from "@/lib/env";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return new NextResponse("Not found", { status: 404 });
  if (!isSupabaseConfigured()) return new NextResponse("Video storage is not configured", { status: 503 });
  const supabase = await createClient();
  const { data: job } = await supabase.from("video_jobs").select("visual_reference_path,status").eq("id", id).maybeSingle();
  if (!job || job.status !== "completed" || !job.visual_reference_path) return new NextResponse("Not found", { status: 404 });
  const { data, error } = await supabase.storage.from("storyflow-videos").createSignedUrl(job.visual_reference_path, 60);
  if (error || !data?.signedUrl) return new NextResponse("Reference image is unavailable", { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { ScriptEditor } from "@/components/script-editor";
import { isUuid } from "@/lib/utils";
import type { Script } from "@/lib/types";
import { VideoJobPanel } from "@/components/video-job-panel";

export const metadata: Metadata = { title: "Script Studio" };

export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await getWorkspaceContext();
  const supabase = await createClient();

  const [{ data: script }, { data: projects }, { data: jobs }] = await Promise.all([
    supabase.from("scripts").select("*").eq("id", id).eq("workspace_id", ctx.current.workspace.id).maybeSingle(),
    supabase
      .from("projects")
      .select("id, name")
      .eq("workspace_id", ctx.current.workspace.id)
      .order("name"),
    supabase.from("video_jobs").select("id,status,stage,progress,output_url,drive_file_url,error,created_at")
      .eq("script_id", id).eq("workspace_id", ctx.current.workspace.id).order("created_at", { ascending: false }).limit(10),
  ]);

  if (!script) notFound();
  const s = script as Script;

  return (
    <>
    <ScriptEditor
      key={s.id}
      script={s}
      projects={(projects ?? []) as Array<{ id: string; name: string }>}
      canDelete={ctx.canManage || s.created_by === ctx.user.id}
    />
    <VideoJobPanel scriptId={s.id} jobs={(jobs ?? []) as Array<{ id: string; status: string; stage: string; progress: number; output_url: string | null; drive_file_url: string | null; error: string | null; created_at: string }>} />
    </>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { PageContainer } from "@/components/page";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ScriptStatusBadge } from "@/components/status";
import { SubmitButton } from "@/components/form";
import { createScriptAction } from "@/actions/scripts";
import { formatDuration, SCRIPT_FORMAT_LABEL, timeAgo } from "@/lib/utils";
import type { Script } from "@/lib/types";

export const metadata: Metadata = { title: "Script Studio" };

export default async function StudioPage() {
  const ctx = await getWorkspaceContext();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scripts")
    .select("id, title, status, format, content, target_duration_seconds, updated_at, project:projects(name)")
    .eq("workspace_id", ctx.current.workspace.id)
    .order("updated_at", { ascending: false })
    .limit(200);

  const scripts = (data ?? []) as unknown as Array<Script & { project: { name: string } | null }>;

  const newScript = (
    <form action={createScriptAction}>
      <SubmitButton pendingText="Creating…">
        <Icon name="plus" /> New script
      </SubmitButton>
    </form>
  );

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Script Studio"
        title="Write scripts your team can ship"
        description="Scene-aware drafting with live pacing estimates. Every change autosaves to this workspace."
        actions={newScript}
      />

      {error ? (
        <Card className="p-6 text-sm text-danger">Could not load scripts: {error.message}</Card>
      ) : scripts.length === 0 ? (
        <Card>
          <EmptyState
            icon="pen"
            title="Your studio is empty"
            description="Create a script to open the editor. Use ## headings to split it into scenes."
            action={newScript}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,1fr)_160px_120px_110px] gap-4 border-b border-border bg-surface-2/50 px-5 py-2.5 text-[11px] font-medium tracking-wide text-muted uppercase md:grid">
            <span>Script</span>
            <span>Format</span>
            <span>Length</span>
            <span className="text-right">Status</span>
          </div>
          <ul className="divide-y divide-border">
            {scripts.map((s) => {
              const words = s.content.trim() ? s.content.trim().split(/\s+/).length : 0;
              return (
                <li key={s.id}>
                  <Link
                    href={`/studio/${s.id}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3.5 hover:bg-surface-2/60 md:grid-cols-[minmax(0,1fr)_160px_120px_110px]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.title}</p>
                      <p className="truncate text-xs text-muted">
                        {s.project?.name ? `${s.project.name} · ` : ""}Edited {timeAgo(s.updated_at)}
                      </p>
                    </div>
                    <span className="hidden text-[13px] text-fg-2 md:block">{SCRIPT_FORMAT_LABEL[s.format]}</span>
                    <span className="hidden text-[13px] text-fg-2 tabular-nums md:block">
                      {formatDuration((words / 150) * 60)} / {formatDuration(s.target_duration_seconds)}
                    </span>
                    <span className="text-right">
                      <ScriptStatusBadge status={s.status} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </PageContainer>
  );
}

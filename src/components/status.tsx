import { Badge } from "@/components/ui";
import { PROJECT_STATUS_LABEL, ROLE_LABEL, SCRIPT_STATUS_LABEL } from "@/lib/utils";
import type { ProjectStatus, ScriptStatus, WorkspaceRole } from "@/lib/types";

const projectTone = {
  draft: "neutral",
  in_progress: "accent",
  review: "warning",
  completed: "success",
  archived: "neutral",
} as const;

const scriptTone = { draft: "neutral", in_review: "warning", approved: "success" } as const;
const roleTone = { owner: "accent", admin: "success", member: "neutral" } as const;

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge tone={projectTone[status]} dot>
      {PROJECT_STATUS_LABEL[status]}
    </Badge>
  );
}

export function ScriptStatusBadge({ status }: { status: ScriptStatus }) {
  return (
    <Badge tone={scriptTone[status]} dot>
      {SCRIPT_STATUS_LABEL[status]}
    </Badge>
  );
}

export function RoleBadge({ role }: { role: WorkspaceRole }) {
  return <Badge tone={roleTone[role]}>{ROLE_LABEL[role]}</Badge>;
}

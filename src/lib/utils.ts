import type { ProjectStatus, ScriptFormat, ScriptStatus, WorkspaceRole } from "@/lib/types";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function initials(nameOrEmail: string | null | undefined) {
  const source = (nameOrEmail ?? "?").trim();
  const base = source.includes("@") ? source.split("@")[0] : source;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : base.slice(0, 2);
  return letters.toUpperCase() || "?";
}

export function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value),
  );
}

export function timeAgo(value: string | Date) {
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, seconds] of units) {
    if (Math.abs(diff) >= seconds) return rtf.format(-Math.round(diff / seconds), unit);
  }
  return "just now";
}

export function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r.toString().padStart(2, "0")}s` : `${r}s`;
}

/** Safe in-app redirect target: only same-origin relative paths. */
export function safeNextPath(value: unknown, fallback = "/dashboard") {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: "Draft",
  in_progress: "In progress",
  review: "In review",
  completed: "Completed",
  archived: "Archived",
};

export const SCRIPT_STATUS_LABEL: Record<ScriptStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
};

export const SCRIPT_FORMAT_LABEL: Record<ScriptFormat, string> = {
  short_form: "Short-form video",
  long_form: "Long-form video",
  ad: "Ad / promo",
  explainer: "Explainer",
  story: "Narrative story",
};

export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

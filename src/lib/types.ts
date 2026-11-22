import type { SubtitleTextConfig } from "@/lib/video/render-settings";

export type WorkspaceRole = "owner" | "admin" | "member";
export type ProjectStatus = "draft" | "in_progress" | "review" | "completed" | "archived";
export type ScriptStatus = "draft" | "in_review" | "approved";
export type ScriptFormat = "short_form" | "long_form" | "ad" | "explainer" | "story";
export type IntegrationProvider = "openai" | "anthropic" | "elevenlabs" | "youtube" | "webhook";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface Membership {
  role: WorkspaceRole;
  workspace: Workspace;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
}

export interface Member {
  user_id: string;
  role: WorkspaceRole;
  created_at: string;
  profile: Pick<Profile, "email" | "full_name" | "avatar_url"> | null;
}

export interface Invitation {
  id: string;
  email: string;
  role: WorkspaceRole;
  token: string;
  status: "pending" | "accepted" | "revoked";
  expires_at: string;
  created_at: string;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Script {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  content: string;
  format: ScriptFormat;
  tone: string;
  target_duration_seconds: number;
  status: ScriptStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceIntegration {
  provider: IntegrationProvider;
  enabled: boolean;
  settings: Record<string, string>;
  updated_at: string;
}

export type VideoJobStatus = "queued" | "running" | "completed" | "failed";
export type VideoOrientation = "portrait" | "landscape";

/** The application-supplied part of a video job (video_jobs.request). */
export interface VideoJobRequest {
  title: string;
  script?: string;
  targetDuration?: number;
  orientation?: VideoOrientation;
  tone?: string;
  voice?: string;
  /** Subtitles on/off. Absent on older jobs, which render with subtitles on. */
  showText?: boolean;
  /** AVG subtitle styling. Absent means engine defaults. */
  textConfig?: SubtitleTextConfig;
  /** AVG music filename in the engine's input/bgm library. Absent means automatic music. */
  backgroundMusic?: string;
}

export interface VideoJob {
  id: string;
  workspace_id: string;
  script_id: string;
  created_by: string;
  status: VideoJobStatus;
  stage: string;
  progress: number;
  request: VideoJobRequest;
  engine_job_id: string | null;
  output_url: string | null;
  visual_reference_path: string | null;
  drive_file_url: string | null;
  quality_report: unknown;
  error: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ActionState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
}

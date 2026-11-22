import type { VideoJobStatus } from "@/lib/types";

/** Script length limits enforced by video_jobs.request and the render engine. */
export const VIDEO_SCRIPT_MIN = 10;
export const VIDEO_SCRIPT_MAX = 4900;

/** Tones understood by the worker's Claude scene-orchestration prompt (request.tone). */
export const VIDEO_TONES = ["conversational", "energetic", "cinematic", "authoritative", "playful", "calm", "inspirational"];

/** Engine voice identifiers (shared with the render-settings validator). */
export { VOICE_PATTERN } from "./render-settings";

export const VIDEO_STATUS_LABEL: Record<VideoJobStatus, string> = {
  queued: "Queued",
  running: "Generating",
  completed: "Ready",
  failed: "Failed",
};

export const VIDEO_STATUS_TONE = {
  queued: "neutral",
  running: "accent",
  completed: "success",
  failed: "danger",
} as const;

export function isActiveJob(status: string) {
  return status === "queued" || status === "running";
}

/** Pipeline steps as the worker reports them through video_jobs.stage. */
export const PIPELINE_STEPS = [
  { key: "queued", label: "Queued", detail: "Waiting for a render worker" },
  { key: "orchestrating", label: "Scene script", detail: "Claude prepares scenes and visual cues" },
  { key: "character", label: "Character reference", detail: "Gemini creates a consistent character" },
  { key: "rendering", label: "Rendering", detail: "Voice, stock media, captions and Remotion render" },
  { key: "quality_check", label: "Quality check", detail: "Post-render analysis (when enabled)" },
  { key: "completed", label: "Ready", detail: "MP4 stored in your workspace" },
] as const;

/** Maps a worker stage (including engine-reported states) to a pipeline step index. */
export function pipelineStepIndex(stage: string, status: string) {
  if (status === "completed") return PIPELINE_STEPS.length - 1;
  switch (stage) {
    case "queued":
      return 0;
    case "starting":
    case "orchestrating":
      return 1;
    case "generating_character_reference":
      return 2;
    case "quality_check":
      return 4;
    case "failed":
      return -1;
    default:
      // "rendering" and any engine-reported state while rendering.
      return status === "queued" ? 0 : 3;
  }
}

export function stageLabel(stage: string, status: string) {
  if (status === "completed") return "Ready to watch";
  if (status === "failed") return "Generation failed";
  const step = PIPELINE_STEPS[pipelineStepIndex(stage, status)];
  if (!step) return stage.replaceAll("_", " ");
  if (step.key === "rendering" && stage !== "rendering") return `Rendering · ${stage.replaceAll("_", " ")}`;
  return step.label;
}

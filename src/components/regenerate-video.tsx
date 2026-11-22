"use client";

import { useActionState } from "react";
import { generateVideoAction } from "@/actions/video";
import { FormMessage, SubmitButton } from "@/components/form";
import { Icon } from "@/components/icons";
import type { ActionState } from "@/lib/types";

/**
 * Queues a new job for the same script with the same settings as an earlier job.
 * `settings` are form entries produced by settingsToFormEntries (voice, subtitles, music);
 * the server action validates them again exactly like a fresh AI Video Studio submission.
 */
export function RegenerateVideo({
  scriptId,
  orientation,
  tone,
  settings = [],
  label = "Generate again",
}: {
  scriptId: string;
  orientation: string;
  tone?: string;
  settings?: Array<[string, string]>;
  label?: string;
}) {
  const [state, action] = useActionState(generateVideoAction, {} as ActionState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="scriptId" value={scriptId} />
      <input type="hidden" name="orientation" value={orientation} />
      {tone && <input type="hidden" name="tone" value={tone} />}
      {settings.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton variant="outline" size="sm" pendingText="Queuing…">
        <Icon name="refresh" size={14} /> {label}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

"use client";

import { useActionState, useState } from "react";
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
  aiProvider,
  paidProviders = [],
  label = "Generate again",
}: {
  scriptId: string;
  orientation: string;
  tone?: string;
  settings?: Array<[string, string]>;
  /** Previous primary AI provider; the workspace's current plan, Free Mode and keys still apply. */
  aiProvider?: string;
  /** Paid providers the previous render used; regenerating requires confirming paid usage again. */
  paidProviders?: string[];
  label?: string;
}) {
  const [state, action] = useActionState(generateVideoAction, {} as ActionState);
  const [confirmed, setConfirmed] = useState(false);
  const needsConfirm = paidProviders.length > 0 || Boolean(state.fieldErrors?.paidAcknowledged);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="scriptId" value={scriptId} />
      <input type="hidden" name="orientation" value={orientation} />
      {tone && <input type="hidden" name="tone" value={tone} />}
      {settings.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {aiProvider && <input type="hidden" name="aiProvider" value={aiProvider} />}
      {needsConfirm && (
        <label className="flex items-start gap-2 text-xs text-warning">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 size-3.5 accent-[var(--accent)]" />
          <span>
            {paidProviders.length > 0 ? `May use a paid provider: ${paidProviders.join(", ")}.` : "This render may use a paid AI provider."} Charges go to your
            own API account.
          </span>
          {confirmed && <input type="hidden" name="paidAcknowledged" value="true" />}
        </label>
      )}
      <SubmitButton variant="outline" size="sm" pendingText="Queuing…" disabled={needsConfirm && !confirmed}>
        <Icon name="refresh" size={14} /> {label}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

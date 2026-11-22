"use client";

import { useActionState, useState } from "react";
import { saveIntegrationAction } from "@/actions/integrations";
import { Badge, Card, Field, Input } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form";
import type { IntegrationDefinition } from "@/lib/integrations";
import type { ActionState } from "@/lib/types";
import { cn } from "@/lib/utils";

export function IntegrationCard({
  definition,
  credentialPresent,
  enabled,
  settings,
  canManage,
}: {
  definition: Pick<IntegrationDefinition, "provider" | "name" | "category" | "description" | "envVars" | "fields" | "note">;
  credentialPresent: boolean;
  enabled: boolean;
  settings: Record<string, string>;
  canManage: boolean;
}) {
  const [state, action] = useActionState(saveIntegrationAction, {} as ActionState);
  const [isEnabled, setIsEnabled] = useState(enabled);
  const needsCredential = definition.envVars.length > 0;

  const status = !needsCredential
    ? { tone: "neutral" as const, label: "No credential needed" }
    : credentialPresent
      ? { tone: "warning" as const, label: "Credential present · not verified" }
      : { tone: "neutral" as const, label: "Not configured" };

  return (
    <Card className="flex flex-col">
      <form action={action} className="flex flex-1 flex-col">
        <input type="hidden" name="provider" value={definition.provider} />
        <div className="flex items-start gap-3 p-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-surface-2 text-sm font-semibold">
            {definition.name.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[15px] font-semibold tracking-tight">{definition.name}</h3>
              <Badge>{definition.category}</Badge>
            </div>
            <p className="mt-1 text-[13px] text-muted">{definition.description}</p>
          </div>
          <label className={cn("relative inline-flex shrink-0 items-center", !canManage && "opacity-50")}>
            <input
              type="checkbox"
              name="enabled"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
              disabled={!canManage}
              className="peer sr-only"
              aria-label={`Enable ${definition.name} for this workspace`}
            />
            <span className="h-5 w-9 rounded-full bg-surface-3 transition-colors peer-checked:bg-accent peer-focus-visible:ring-4 peer-focus-visible:ring-[var(--ring)]" />
            <span className="absolute left-0.5 size-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
          </label>
        </div>

        <div className="space-y-4 border-t border-border px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
            <span className="text-muted">Server credential</span>
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
          </div>
          {needsCredential && (
            <p className="text-xs text-muted">
              Set{" "}
              {definition.envVars.map((v, i) => (
                <span key={v}>
                  {i > 0 && " and "}
                  <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[11px] text-fg-2">{v}</code>
                </span>
              ))}{" "}
              in the server environment. Keys are never stored in the database or sent to the browser.
            </p>
          )}
          {definition.fields.map((f) => (
            <Field key={f.key} label={f.label} htmlFor={`${definition.provider}-${f.key}`} error={state.fieldErrors?.[f.key]} hint={f.help}>
              <Input
                id={`${definition.provider}-${f.key}`}
                name={f.key}
                type={f.type ?? "text"}
                defaultValue={settings[f.key] ?? ""}
                placeholder={f.placeholder}
                disabled={!canManage}
                maxLength={300}
              />
            </Field>
          ))}
          {definition.note && <p className="text-xs text-muted">{definition.note}</p>}
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <FormMessage state={state} className="py-1" />
          <SubmitButton size="sm" variant="outline" disabled={!canManage} className="ml-auto" pendingText="Saving…">
            Save
          </SubmitButton>
        </div>
      </form>
    </Card>
  );
}

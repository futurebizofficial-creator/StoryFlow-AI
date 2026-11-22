"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import {
  removeProviderKeyAction,
  saveGenerationSettingsAction,
  saveProviderKeyAction,
  setProviderEnabledAction,
  testProviderAction,
} from "@/actions/integrations-hub";
import { disconnectDriveAction } from "@/actions/video";
import { Badge, buttonClass, Card, Field, Input, Select } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { CATEGORIES, PRICING_LABEL, type ProviderDefinition } from "@/lib/integrations/catalog";
import { applyFreeModeToOrder, MAX_AI_PROVIDERS, providerSelectability, type GenerationSettings } from "@/lib/integrations/plan";
import type { TestResult } from "@/lib/integrations/testers";
import type { ActionState } from "@/lib/types";

export interface HubProps {
  providers: ProviderDefinition[];
  savedKeys: string[];
  disabled: string[];
  canManage: boolean;
  settings: GenerationSettings;
  /** Database error while loading saved settings (shown instead of silently using defaults). */
  settingsError?: string | null;
  drive: { connected: boolean; email: string | null; configured: boolean };
  notice?: { tone: "success" | "danger"; text: string } | null;
}

const PRICING_TONE = { free: "success", free_tier: "accent", paid: "warning" } as const;

export function IntegrationsHub(props: HubProps) {
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const keys = new Set(props.savedKeys);
  const disabled = new Set(props.disabled);
  const llms = props.providers.filter((p) => p.llm);

  return (
    <div className="space-y-10">
      {props.notice && (
        <p role={props.notice.tone === "danger" ? "alert" : "status"} className={cn("rounded-xl px-4 py-3 text-sm", props.notice.tone === "danger" ? "bg-danger-soft text-danger" : "bg-success-soft text-success")}>
          {props.notice.text}
        </p>
      )}

      <nav aria-label="Integration categories" className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => (
          <a key={c.id} href={`#${c.id}`} className="rounded-full border border-border px-3 py-1.5 text-[13px] font-medium text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg">
            {c.label}
          </a>
        ))}
      </nav>

      {CATEGORIES.map((category) => (
        <section key={category.id} id={category.id} className="scroll-mt-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{category.label}</h2>
            <p className="text-sm text-muted">{category.description}</p>
          </div>

          {category.id === "ai" && (
            <GenerationSettingsPanel
              llms={llms}
              settings={props.settings}
              settingsError={props.settingsError ?? null}
              canManage={props.canManage}
              keys={keys}
              disabled={disabled}
              models={Object.fromEntries(Object.entries(tests).map(([id, t]) => [id, t.models ?? []]))}
            />
          )}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {props.providers
              .filter((p) => p.category === category.id)
              .map((p) => (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  hasKey={keys.has(p.id)}
                  disabled={disabled.has(p.id)}
                  canManage={props.canManage}
                  test={tests[p.id]}
                  onTested={(result) => setTests((t) => ({ ...t, [p.id]: result }))}
                  drive={p.id === "google_drive" ? props.drive : undefined}
                />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ProviderCard({
  provider: p,
  hasKey,
  disabled,
  canManage,
  test,
  onTested,
  drive,
}: {
  provider: ProviderDefinition;
  hasKey: boolean;
  disabled: boolean;
  canManage: boolean;
  test?: TestResult;
  onTested: (r: TestResult) => void;
  drive?: HubProps["drive"];
}) {
  const [keyState, keyAction] = useActionState(saveProviderKeyAction, {} as ActionState);
  const [removeState, removeAction] = useActionState(removeProviderKeyAction, {} as ActionState);
  const [enableState, enableAction] = useActionState(setProviderEnabledAction, {} as ActionState);
  const [testing, startTest] = useTransition();
  const [editing, setEditing] = useState(false);

  const testable = p.status === "available" && (p.auth === "api_key" || p.auth === "none");
  const connected =
    p.auth === "api_key" ? hasKey : p.id === "google_drive" ? Boolean(drive?.connected) : p.status === "builtin" || p.auth === "none";

  const status =
    p.status === "requires_approval"
      ? { tone: "warning" as const, label: "Requires platform approval" }
      : p.status === "manual"
        ? { tone: "neutral" as const, label: "Manual workflow" }
        : p.status === "builtin"
          ? { tone: "success" as const, label: "Built in" }
          : test && connected
            ? test.ok
              ? { tone: "success" as const, label: "Connected" }
              : { tone: "danger" as const, label: "Test failed" }
            : p.auth === "api_key"
              ? hasKey
                ? { tone: "accent" as const, label: "Key saved · not tested" }
                : { tone: "neutral" as const, label: "Not connected" }
              : connected
                ? { tone: "success" as const, label: p.auth === "none" ? "Available · no key" : "Connected" }
                : { tone: "neutral" as const, label: "Not connected" };

  return (
    <Card className={cn("flex flex-col", disabled && "opacity-70")}>
      <div className="flex items-start gap-3 p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-surface-2 text-sm font-semibold">
          {p.name.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold tracking-tight">{p.name}</h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge tone={PRICING_TONE[p.pricing]}>{PRICING_LABEL[p.pricing]}</Badge>
            <Badge tone={status.tone} dot>{status.label}</Badge>
            {disabled && <Badge tone="danger">Disabled</Badge>}
          </div>
        </div>
        {canManage && p.status !== "manual" && p.status !== "requires_approval" && (
          <form action={enableAction}>
            <input type="hidden" name="provider" value={p.id} />
            <input type="hidden" name="enabled" value={disabled ? "true" : "false"} />
            <button
              type="submit"
              className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors", disabled ? "bg-surface-3" : "bg-accent")}
              aria-label={`${disabled ? "Enable" : "Disable"} ${p.name} for this workspace`}
              aria-pressed={!disabled}
              title={disabled ? "Disabled for this workspace" : "Enabled for this workspace"}
            >
              <span className={cn("absolute left-0.5 size-4 rounded-full bg-white shadow transition-transform", !disabled && "translate-x-4")} />
            </button>
          </form>
        )}
      </div>

      <div className="flex-1 space-y-3 border-t border-border px-5 py-4 text-[13px]">
        <p className="text-fg-2">{p.usage}</p>
        <ul className="space-y-1 text-xs text-muted">
          {p.uses.map((u) => (
            <li key={u} className="flex gap-1.5">
              <Icon name="check" size={12} className="mt-0.5 shrink-0 text-accent" /> {u}
            </li>
          ))}
        </ul>
        {p.approval && <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">{p.approval}</p>}
        {p.scopes && p.scopes.length > 0 && (
          <p className="text-xs text-muted">
            OAuth scopes: {p.scopes.map((s) => <code key={s} className="mr-1 rounded bg-surface-3 px-1 font-mono text-[11px]">{s}</code>)}
          </p>
        )}
        {p.license && <p className="text-xs text-muted">Licence: {p.license} — keep creator attribution and source links.</p>}

        {/* API key connect / replace / disconnect */}
        {p.auth === "api_key" && p.status === "available" && (
          (!hasKey || editing) ? (
            <form action={keyAction} className="space-y-2" onSubmit={() => setEditing(false)}>
              <input type="hidden" name="provider" value={p.id} />
              <Field label={hasKey ? "Replace API key" : "API key"} htmlFor={`key-${p.id}`} error={keyState.fieldErrors?.apiKey}>
                <Input id={`key-${p.id}`} name="apiKey" type="password" autoComplete="off" spellCheck={false} required minLength={8} maxLength={500} placeholder="Paste your key" />
              </Field>
              <div className="flex items-center gap-2">
                <SubmitButton size="sm" pendingText="Encrypting…">{hasKey ? "Replace" : "Connect"}</SubmitButton>
                {hasKey && <button type="button" onClick={() => setEditing(false)} className="text-xs text-muted hover:text-fg">Cancel</button>}
              </div>
              <FormMessage state={keyState} />
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setEditing(true)} className="h-8 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-surface-2">Replace key</button>
              <form action={removeAction}>
                <input type="hidden" name="provider" value={p.id} />
                <SubmitButton size="sm" variant="ghost" className="text-danger" pendingText="Removing…">Disconnect</SubmitButton>
              </form>
              <FormMessage state={keyState.success ? keyState : removeState} />
            </div>
          )
        )}

        {/* Google Drive keeps its existing OAuth flow */}
        {drive && (
          <div className="flex flex-wrap items-center gap-2">
            {drive.configured ? (
              <a href="/api/integrations/google-drive/connect" className="h-8 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2">
                {drive.connected ? "Reconnect" : "Connect Google Drive"}
              </a>
            ) : (
              <span className="text-xs text-muted">Google OAuth client is not configured on the server.</span>
            )}
            {drive.connected && (
              <form action={disconnectDriveAction}>
                <SubmitButton size="sm" variant="ghost" className="text-danger" pendingText="Disconnecting…">Disconnect</SubmitButton>
              </form>
            )}
            {drive.connected && drive.email && <span className="w-full text-xs text-muted">Connected as {drive.email}</span>}
          </div>
        )}

        {testable && (
          <div className="space-y-2">
            <button
              type="button"
              disabled={testing || (p.auth === "api_key" && !hasKey)}
              onClick={() => startTest(async () => onTested(await testProviderAction(p.id)))}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-surface-2 disabled:opacity-50"
            >
              {testing ? <span className="size-3 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" /> : <Icon name="activity" size={13} />}
              Test connection
            </button>
            {test && (
              <div role="status" className={cn("rounded-lg px-3 py-2 text-xs", test.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
                <p className="font-medium">
                  {test.message}
                  {typeof test.latencyMs === "number" ? ` · ${test.latencyMs} ms` : ""}
                </p>
                {test.limits && test.limits.length > 0 && (
                  <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-fg-2">
                    {test.limits.map((l) => (
                      <div key={l.label} className="contents">
                        <dt className="text-muted">{l.label}</dt>
                        <dd className="truncate tabular-nums">{l.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            )}
          </div>
        )}
        <FormMessage state={enableState} />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-5 py-3 text-xs">
        <a href={p.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
          Documentation <Icon name="external" size={11} />
        </a>
        {p.pricingUrl && (
          <a href={p.pricingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-fg">
            Pricing <Icon name="external" size={11} />
          </a>
        )}
        {p.keyUrl && p.auth === "api_key" && (
          <a href={p.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-fg">
            Get a key <Icon name="external" size={11} />
          </a>
        )}
      </div>
    </Card>
  );
}


function GenerationSettingsPanel({
  llms,
  settings,
  settingsError,
  canManage,
  keys,
  disabled,
  models,
}: {
  llms: ProviderDefinition[];
  settings: GenerationSettings;
  settingsError: string | null;
  canManage: boolean;
  keys: Set<string>;
  disabled: Set<string>;
  models: Record<string, string[]>;
}) {
  const [state, action, pending] = useActionState(saveGenerationSettingsAction, {} as ActionState);
  const [freeMode, setFreeMode] = useState(settings.freeMode);
  const [order, setOrder] = useState<string[]>(() => Array.from({ length: MAX_AI_PROVIDERS }, (_, i) => settings.aiProviders[i] ?? ""));
  const [modelValues, setModelValues] = useState<Record<string, string>>(settings.aiModels);
  const [removedNotice, setRemovedNotice] = useState<string | null>(null);
  const chosen = Array.from(new Set(order.filter(Boolean)));
  const name = (id: string) => llms.find((l) => l.id === id)?.name ?? id;
  const ctx = { freeMode, keys, disabled };

  const toggleFreeMode = (on: boolean) => {
    setFreeMode(on);
    if (on) {
      const { order: next, removed } = applyFreeModeToOrder(order);
      setOrder(next);
      setRemovedNotice(removed.length ? `Removed paid provider${removed.length > 1 ? "s" : ""} for Free Mode: ${removed.map(name).join(", ")}.` : null);
    } else {
      setRemovedNotice(null);
    }
  };

  return (
    <Card className="relative overflow-hidden">
      <div className="glow absolute inset-0 opacity-40" aria-hidden="true" />
      <form
        // Submitted from component state, not the DOM: React would otherwise reset the form after
        // the action (showing stale defaults such as Claude), and disabled options are never sent.
        onSubmit={(e) => {
          e.preventDefault();
          if (!canManage || pending) return;
          const fd = new FormData();
          fd.set("freeMode", freeMode ? "true" : "false");
          order.forEach((id, i) => fd.set(`provider_${i}`, id));
          for (const id of chosen) fd.set(`model_${id}`, modelValues[id] ?? "");
          startTransition(() => action(fd));
        }}
        aria-busy={pending}
        className="relative space-y-5 p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold tracking-tight">Video generation providers</h3>
            <p className="text-[13px] text-muted">Scene planning tries these in order. Fallback happens only to providers listed here.</p>
          </div>
          <label className={cn("flex items-center gap-2 text-sm font-medium", !canManage && "opacity-60")}>
            <input type="checkbox" checked={freeMode} disabled={!canManage} onChange={(e) => toggleFreeMode(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            Free Mode <Badge tone={freeMode ? "success" : "neutral"}>{freeMode ? "On" : "Off"}</Badge>
          </label>
        </div>

        {settingsError && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
            Saved settings could not be loaded: {settingsError}
          </p>
        )}
        {settings.isDefault && !settingsError && (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
            Not configured yet — renders use Anthropic Claude (Paid) until you save a provider here.
          </p>
        )}

        <p className={cn("rounded-lg px-3 py-2 text-xs", freeMode ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
          {freeMode
            ? "Free Mode is on: only free and free-tier providers are used, there is never a paid fallback, and a render stops if the free quota is exhausted. A free-tier key can still be billed if its account has billing enabled. Rendering and hosting costs are separate."
            : "Free Mode is off: paid providers can be used, but each render must confirm paid usage first. Turn on Free Mode to block paid providers entirely."}
        </p>
        {removedNotice && <p role="status" className="text-xs text-warning">{removedNotice}</p>}

        <div className="grid gap-3 md:grid-cols-2">
          {order.map((value, i) => {
            const current = value ? providerSelectability(value, ctx) : null;
            return (
              <Field key={i} label={i === 0 ? "Primary" : `Fallback ${i}`} htmlFor={`provider_${i}`} error={state.fieldErrors?.[`provider_${i}`]}>
                <Select
                  id={`provider_${i}`}
                  value={value}
                  disabled={!canManage}
                  onChange={(e) => setOrder((o) => o.map((v, j) => (j === i ? e.target.value : v)))}
                >
                  <option value="">{i === 0 ? "Choose a provider" : "None"}</option>
                  {llms.map((l) => {
                    const sel = providerSelectability(l.id, ctx);
                    const usedElsewhere = order.some((v, j) => j !== i && v === l.id);
                    return (
                      <option key={l.id} value={l.id} disabled={(!sel.selectable && value !== l.id) || usedElsewhere}>
                        {l.name} · {PRICING_LABEL[l.pricing]}
                        {sel.reason ? ` · ${sel.reason}` : ""}
                      </option>
                    );
                  })}
                </Select>
                {current && !current.selectable && (
                  <span className="text-xs text-danger">
                    {name(value)} is {current.reason}. Choose another provider.
                  </span>
                )}
              </Field>
            );
          })}
        </div>

        {chosen.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2">
            {chosen.map((id) => (
              <Field
                key={id}
                label={`${name(id)} model`}
                htmlFor={`model_${id}`}
                hint={
                  id === "anthropic"
                    ? "Optional — defaults to the worker's CLAUDE_MODEL."
                    : models[id]?.length
                      ? `${models[id].length} models from your connection test.`
                      : "Required. Run Test connection on the card to list models."
                }
                error={state.fieldErrors?.[`model_${id}`]}
              >
                <Input
                  id={`model_${id}`}
                  list={`models-${id}`}
                  value={modelValues[id] ?? ""}
                  onChange={(e) => setModelValues((m) => ({ ...m, [id]: e.target.value }))}
                  disabled={!canManage}
                  maxLength={128}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="Model id"
                />
                <datalist id={`models-${id}`}>
                  {(models[id] ?? []).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Field>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {canManage ? (
            <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass("primary", "sm")}>
              {pending && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />}
              {pending ? "Saving…" : "Save generation settings"}
            </button>
          ) : (
            <p className="text-xs text-muted">Only owners and admins can change these settings.</p>
          )}
          <FormMessage state={state} />
        </div>
        <p className="text-xs text-muted">
          Voice, music and stock footage in renders come from the render engine (Automated Video Generator). Choosing ElevenLabs,
          Google TTS or a stock library for renders needs engine support first.
        </p>
      </form>
    </Card>
  );
}

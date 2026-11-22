"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
import { deleteScriptAction, saveScriptAction } from "@/actions/scripts";
import { Icon } from "@/components/icons";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { FormMessage } from "@/components/form";
import { cn, formatDuration, SCRIPT_FORMAT_LABEL, SCRIPT_STATUS_LABEL } from "@/lib/utils";
import type { ActionState, Script } from "@/lib/types";

const WPM = 150;
const SCENE_RE = /^\s*(#{1,3}\s+\S.*|scene\b.*|(int|ext)\.\s.*)$/i;
const TONES = ["conversational", "energetic", "cinematic", "authoritative", "playful", "calm", "inspirational"];

function countWords(text: string) {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

function parseScenes(content: string) {
  const lines = content.split("\n");
  const scenes: Array<{ title: string; words: number; line: number }> = [];
  let current: { title: string; words: number; line: number } | null = null;
  lines.forEach((line, idx) => {
    if (SCENE_RE.test(line)) {
      current = { title: line.replace(/^#+\s*/, "").trim(), words: 0, line: idx };
      scenes.push(current);
    } else if (current) {
      current.words += countWords(line);
    } else if (line.trim()) {
      current = { title: "Opening", words: countWords(line), line: 0 };
      scenes.push(current);
    }
  });
  return scenes;
}

export function ScriptEditor({
  script,
  projects,
  canDelete,
}: {
  script: Script;
  projects: Array<{ id: string; name: string }>;
  canDelete: boolean;
}) {
  const [state, saveAction, saving] = useActionState(saveScriptAction, {} as ActionState);
  const [deleteState, deleteAction, deleting] = useActionState(deleteScriptAction, {} as ActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = useState(script.content);
  const [title, setTitle] = useState(script.title);
  const [duration, setDuration] = useState(script.target_duration_seconds);
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const words = countWords(content);
  const estimated = (words / WPM) * 60;
  const ratio = duration > 0 ? estimated / duration : 0;
  const scenes = useMemo(() => parseScenes(content), [content]);

  const save = useCallback(() => {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    setDirty(false);
    startTransition(() => saveAction(fd));
  }, [saveAction]);

  // Autosave 2.5s after the last change.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(save, 2500);
    return () => clearTimeout(t);
  }, [dirty, content, title, duration, save]);

  // Cmd/Ctrl+S to save; warn on unload with unsaved changes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [dirty, save]);

  const insertScene = () => {
    const n = scenes.filter((s) => s.title !== "Opening").length + 1;
    const prefix = content.length && !content.endsWith("\n") ? "\n\n" : content.length ? "\n" : "";
    const next = `${content}${prefix}## Scene ${n}\n`;
    setContent(next);
    setDirty(true);
    requestAnimationFrame(() => {
      const el = textRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(next.length, next.length);
        el.scrollTop = el.scrollHeight;
      }
    });
  };

  const jumpTo = (line: number) => {
    const el = textRef.current;
    if (!el) return;
    const offset = content.split("\n").slice(0, line).join("\n").length + (line > 0 ? 1 : 0);
    el.focus();
    el.setSelectionRange(offset, offset);
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 28;
    el.scrollTop = Math.max(0, line * lineHeight - 40);
    setPanelOpen(false);
  };

  const saveLabel = saving ? "Saving…" : dirty ? "Unsaved changes" : state.error ? "Save failed" : state.success ?? "All changes saved";

  return (
    <form
      ref={formRef}
      onChange={() => setDirty(true)}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex min-h-[calc(100dvh-3.5rem)] flex-col lg:min-h-dvh"
    >
      <input type="hidden" name="id" value={script.id} />

      {/* Toolbar */}
      <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 border-b border-border bg-bg/90 px-4 py-2.5 backdrop-blur-md sm:px-6 lg:top-0">
        <Link href="/studio" aria-label="Back to Script Studio" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg">
          <Icon name="chevronLeft" />
        </Link>
        <input
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={160}
          aria-label="Script title"
          className="min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1 text-[15px] font-semibold tracking-tight outline-none hover:bg-surface-2 focus:bg-surface-2"
        />
        <span
          className={cn("hidden text-xs sm:inline", state.error && !dirty ? "text-danger" : "text-muted")}
          aria-live="polite"
        >
          {saveLabel}
        </span>
        <Button type="button" variant="outline" size="sm" className="lg:hidden" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen}>
          <Icon name="layers" /> Details
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      {state.error && (
        <div className="px-4 pt-3 sm:px-6">
          <FormMessage state={state} />
        </div>
      )}

      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Editor */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2 sm:px-6">
            <Button type="button" variant="ghost" size="sm" onClick={insertScene}>
              <Icon name="plus" /> Scene
            </Button>
            <span className="ml-auto text-xs text-muted tabular-nums">
              {words.toLocaleString()} words · {content.length.toLocaleString()} chars
            </span>
          </div>
          <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-8">
            <textarea
              ref={textRef}
              name="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={100000}
              aria-label="Script content"
              placeholder={"## Hook\nOpen with a question your audience can't ignore…\n\n## Scene 1\nSet the stage…"}
              className="h-full min-h-[60dvh] w-full resize-none bg-transparent text-[16px] leading-[1.75] text-fg outline-none placeholder:text-muted/60"
            />
          </div>
        </div>

        {/* Inspector */}
        <aside
          className={cn(
            "border-t border-border bg-surface/50 lg:sticky lg:top-[53px] lg:block lg:h-[calc(100dvh-53px)] lg:w-[320px] lg:shrink-0 lg:overflow-y-auto lg:border-t-0 lg:border-l",
            panelOpen ? "block" : "hidden",
          )}
        >
          <div className="space-y-6 p-5">
            <section>
              <h3 className="mb-3 text-[11px] font-medium tracking-wide text-muted uppercase">Pacing</h3>
              <div className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-semibold tracking-tight tabular-nums">{formatDuration(estimated)}</span>
                  <span className="text-xs text-muted">of {formatDuration(duration)} target</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className={cn("h-full rounded-full transition-all", ratio > 1.1 ? "bg-warning" : ratio >= 0.85 ? "bg-success" : "bg-accent")}
                    style={{ width: `${Math.min(100, ratio * 100)}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted">
                  {ratio > 1.1
                    ? "Running long — consider trimming."
                    : ratio >= 0.85
                      ? "On target."
                      : `About ${Math.max(0, Math.round(((duration - estimated) / 60) * WPM))} more words to target.`}{" "}
                  Estimated at {WPM} wpm.
                </p>
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-[11px] font-medium tracking-wide text-muted uppercase">Settings</h3>
              <Field label="Status" htmlFor="status">
                <Select id="status" name="status" defaultValue={script.status}>
                  {Object.entries(SCRIPT_STATUS_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Project" htmlFor="projectId">
                <Select id="projectId" name="projectId" defaultValue={script.project_id ?? ""}>
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Format" htmlFor="format">
                <Select id="format" name="format" defaultValue={script.format}>
                  {Object.entries(SCRIPT_FORMAT_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Tone" htmlFor="tone">
                <Select id="tone" name="tone" defaultValue={TONES.includes(script.tone) ? script.tone : "conversational"}>
                  {TONES.map((t) => (
                    <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Target duration (seconds)" htmlFor="targetDuration">
                <Input
                  id="targetDuration"
                  name="targetDuration"
                  type="number"
                  min={5}
                  max={7200}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value) || 0)}
                />
              </Field>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[11px] font-medium tracking-wide text-muted uppercase">Outline</h3>
                <Badge>{scenes.length} {scenes.length === 1 ? "section" : "sections"}</Badge>
              </div>
              {scenes.length === 0 ? (
                <p className="text-xs text-muted">
                  Start a line with <code className="rounded bg-surface-3 px-1">## </code>, <code className="rounded bg-surface-3 px-1">SCENE</code>, <code className="rounded bg-surface-3 px-1">INT.</code> or <code className="rounded bg-surface-3 px-1">EXT.</code> to create sections.
                </p>
              ) : (
                <ol className="space-y-1">
                  {scenes.map((s, i) => (
                    <li key={`${s.line}-${i}`}>
                      <button
                        type="button"
                        onClick={() => jumpTo(s.line)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-surface-2"
                      >
                        <span className="grid size-5 shrink-0 place-items-center rounded-md bg-surface-3 text-[10px] font-semibold tabular-nums">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate">{s.title}</span>
                        <span className="text-[11px] text-muted tabular-nums">{formatDuration((s.words / WPM) * 60)}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="rounded-xl border border-dashed border-border-strong p-4">
              <div className="flex items-center gap-2 text-[13px] font-medium">
                <Icon name="sparkles" className="text-accent" /> AI writing assistant
              </div>
              <p className="mt-1.5 text-xs text-muted">
                Not connected. AI drafting is not enabled in this release. Provider settings live in{" "}
                <Link href="/settings/integrations" className="text-accent hover:underline">Integrations</Link>.
              </p>
            </section>

            {canDelete && (
              <section className="border-t border-border pt-5">
                {!confirmDelete ? (
                  <Button type="button" variant="ghost" size="sm" className="text-danger" onClick={() => setConfirmDelete(true)}>
                    <Icon name="trash" /> Delete script
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-fg-2">Delete this script permanently?</p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        disabled={deleting}
                        onClick={() => {
                          const fd = new FormData();
                          fd.set("id", script.id);
                          setDirty(false);
                          startTransition(() => deleteAction(fd));
                        }}
                      >
                        {deleting ? "Deleting…" : "Delete"}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                        Cancel
                      </Button>
                    </div>
                    <FormMessage state={deleteState} />
                  </div>
                )}
              </section>
            )}
          </div>
        </aside>
      </div>
    </form>
  );
}

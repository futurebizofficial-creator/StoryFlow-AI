"use client";

import Link from "next/link";
import { startTransition, useActionState, useMemo, useState } from "react";
import { generateVideoAction } from "@/actions/video";
import { Alert, Badge, buttonClass, Card, Field, Input, Select } from "@/components/ui";
import { FormMessage } from "@/components/form";
import { Icon } from "@/components/icons";
import { cn, formatDuration, timeAgo } from "@/lib/utils";
import { PIPELINE_STEPS, VIDEO_SCRIPT_MAX, VIDEO_TONES } from "@/lib/video/status";
import {
  SUBTITLE_ANIMATIONS,
  SUBTITLE_BACKGROUNDS,
  SUBTITLE_FONT_MAX,
  SUBTITLE_FONT_MIN,
  SUBTITLE_POSITIONS,
} from "@/lib/video/render-settings";
import { VoicePicker, type VoicePickerGroup } from "@/components/voice-picker";
import type { ActionState } from "@/lib/types";

export interface StudioScript {
  id: string;
  title: string;
  tone: string;
  targetDuration: number;
  words: number;
  chars: number;
  estimatedSeconds: number;
  excerpt: string;
  issue: string | null;
  updatedAt: string;
}

const ORIENTATIONS = [
  { value: "portrait", label: "Portrait", ratio: "9:16", hint: "Shorts, Reels, TikTok", box: "h-10 w-6" },
  { value: "landscape", label: "Landscape", ratio: "16:9", hint: "YouTube, web, presentations", box: "h-6 w-10" },
] as const;

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

export function VideoStudioForm({
  scripts,
  initialScriptId,
  readiness,
  voiceGroups,
  voiceStatus,
}: {
  scripts: StudioScript[];
  initialScriptId: string;
  readiness: { claude: boolean; gemini: boolean; drive: string | null };
  voiceGroups: VoicePickerGroup[] | null;
  voiceStatus: "ok" | "unconfigured" | "unavailable";
}) {
  const [state, action, pending] = useActionState(generateVideoAction, {} as ActionState);
  const [voice, setVoice] = useState("");
  const [showText, setShowText] = useState(true);
  const [subtitle, setSubtitle] = useState({ position: "", animation: "", background: "", fontSize: "", glow: "" });
  const [customColor, setCustomColor] = useState(false);
  const [color, setColor] = useState("#FFFFFF");
  const [musicMode, setMusicMode] = useState<"auto" | "file">("auto");
  const [musicFile, setMusicFile] = useState("");
  const setSub = (key: keyof typeof subtitle) => (e: { target: { value: string } }) => setSubtitle((s) => ({ ...s, [key]: e.target.value }));
  const err = state.fieldErrors ?? {};
  const [scriptId, setScriptId] = useState(initialScriptId);
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const selected = useMemo(() => scripts.find((s) => s.id === scriptId), [scripts, scriptId]);
  const [tone, setTone] = useState(selected && VIDEO_TONES.includes(selected.tone) ? selected.tone : "conversational");

  const keysReady = readiness.claude && readiness.gemini;
  const canGenerate = Boolean(selected && !selected.issue && keysReady);

  const chooseScript = (id: string) => {
    setScriptId(id);
    const next = scripts.find((s) => s.id === id);
    if (next) setTone(VIDEO_TONES.includes(next.tone) ? next.tone : "conversational");
  };

  return (
    <form
      // Submitted manually so React does not auto-reset the form after the action: a returned
      // validation error must keep the user's choices (controlled selects/radios would desync).
      onSubmit={(e) => {
        e.preventDefault();
        if (pending || !canGenerate) return;
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
      aria-busy={pending}
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"
    >
      <div className="space-y-6">
        {/* 1. Script */}
        <Card>
          <div className="flex items-center gap-3 border-b border-border px-5 py-4">
            <StepNumber n={1} />
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold tracking-tight">Script</h2>
              <p className="text-[13px] text-muted">The narration and scene structure for your video.</p>
            </div>
            <Link href="/studio" className="text-[13px] font-medium text-accent hover:underline">
              Script Studio
            </Link>
          </div>
          <div className="space-y-4 p-5">
            <Field label="Choose a script" htmlFor="scriptId" error={state.fieldErrors?.scriptId}>
              <Select id="scriptId" name="scriptId" value={scriptId} onChange={(e) => chooseScript(e.target.value)} required>
                <option value="" disabled>
                  Select a script…
                </option>
                {scripts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                    {s.issue ? " — not renderable" : ""}
                  </option>
                ))}
              </Select>
            </Field>

            {selected && (
              <div className="rounded-xl border border-border bg-surface-2/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{selected.title}</p>
                  {selected.issue ? <Badge tone="warning" dot>Needs edits</Badge> : <Badge tone="success" dot>Ready to render</Badge>}
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
                  <Stat label="Words" value={selected.words.toLocaleString()} />
                  <Stat label="Narration" value={formatDuration(selected.estimatedSeconds)} />
                  <Stat label="Characters" value={`${selected.chars.toLocaleString()}`} hint={`max ${VIDEO_SCRIPT_MAX.toLocaleString()}`} />
                </dl>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className={cn("h-full rounded-full", selected.chars > VIDEO_SCRIPT_MAX ? "bg-warning" : "bg-brand")}
                    style={{ width: `${Math.min(100, (selected.chars / VIDEO_SCRIPT_MAX) * 100)}%` }}
                  />
                </div>
                {selected.excerpt && (
                  <p className="mt-3 line-clamp-3 text-[13px] leading-relaxed whitespace-pre-line text-fg-2">{selected.excerpt}</p>
                )}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                  <span>
                    Edited {timeAgo(selected.updatedAt)} · target {formatDuration(selected.targetDuration)}
                  </span>
                  <Link href={`/studio/${selected.id}`} className="font-medium text-accent hover:underline">
                    Edit script
                  </Link>
                </div>
                {selected.issue && <p className="mt-2 text-xs text-warning">{selected.issue}. Edit it in Script Studio before rendering.</p>}
              </div>
            )}
          </div>
        </Card>

        {/* 2. Format */}
        <Card>
          <div className="flex items-center gap-3 border-b border-border px-5 py-4">
            <StepNumber n={2} />
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Format</h2>
              <p className="text-[13px] text-muted">Frame size for the rendered MP4.</p>
            </div>
          </div>
          <fieldset className="grid gap-3 p-5 sm:grid-cols-2">
            <legend className="sr-only">Orientation</legend>
            {ORIENTATIONS.map((o) => (
              <label
                key={o.value}
                className={cn(
                  "flex cursor-pointer items-center gap-4 rounded-xl border p-4 transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-accent",
                  orientation === o.value ? "border-accent bg-accent-soft/60 ring-1 ring-accent/40" : "border-border hover:border-border-strong hover:bg-surface-2",
                )}
              >
                <input
                  type="radio"
                  name="orientation"
                  value={o.value}
                  checked={orientation === o.value}
                  onChange={() => setOrientation(o.value)}
                  className="sr-only"
                />
                <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-surface-3">
                  <span className={cn("rounded-[3px] border-2", o.box, orientation === o.value ? "border-accent" : "border-muted")} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">
                    {o.label} <span className="font-normal text-muted">{o.ratio}</span>
                  </span>
                  <span className="block text-xs text-muted">{o.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </Card>

        {/* 3. Voice & style */}
        <Card>
          <div className="flex items-center gap-3 border-b border-border px-5 py-4">
            <StepNumber n={3} />
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Voice &amp; direction</h2>
              <p className="text-[13px] text-muted">Passed to the scene planner and the narration engine.</p>
            </div>
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Tone" htmlFor="tone" hint="Guides Claude's scene and visual-cue planning." error={state.fieldErrors?.tone}>
              <Select id="tone" name="tone" value={tone} onChange={(e) => setTone(e.target.value)}>
                {VIDEO_TONES.map((t) => (
                  <option key={t} value={t}>
                    {capitalize(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field
                label="Narration voice"
                htmlFor="voice"
                hint={
                  voiceGroups
                    ? "Voices available on the render engine. Leave on the default to use the engine's standard voice."
                    : voiceStatus === "unconfigured"
                      ? "The voice list is not configured on this server. Enter an engine voice ID, or leave blank for the default."
                      : "The voice list is temporarily unavailable. Enter an engine voice ID, or leave blank for the default."
                }
                error={err.voice}
              >
                <VoicePicker id="voice" groups={voiceGroups} value={voice} onChange={setVoice} invalid={Boolean(err.voice)} />
              </Field>
            </div>
          </div>
          <div className="border-t border-border px-5 py-4">
            <p className="mb-2 text-[11px] font-medium tracking-wide text-muted uppercase">Always included</p>
            <ul className="grid gap-2 text-[13px] text-fg-2 sm:grid-cols-2">
              <li className="flex items-center gap-2"><Icon name="check" size={14} className="text-success" /> Caption file export</li>
              <li className="flex items-center gap-2"><Icon name="check" size={14} className="text-success" /> Consistent character reference</li>
              <li className="flex items-center gap-2"><Icon name="check" size={14} className="text-success" /> Video thumbnail</li>
              <li className="flex items-center gap-2"><Icon name="check" size={14} className="text-success" /> Target length from the script ({selected ? formatDuration(selected.targetDuration) : "—"})</li>
            </ul>
          </div>
        </Card>

        {/* 4. Subtitles */}
        <Card>
          <div className="flex items-center gap-3 border-b border-border px-5 py-4">
            <StepNumber n={4} />
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold tracking-tight">Subtitles</h2>
              <p className="text-[13px] text-muted">Burned-in captions styled by the render engine.</p>
            </div>
            <label className="relative inline-flex shrink-0 cursor-pointer items-center gap-2 text-[13px] font-medium">
              <input type="hidden" name="showText" value={showText ? "true" : "false"} />
              <input
                type="checkbox"
                checked={showText}
                onChange={(e) => setShowText(e.target.checked)}
                className="peer sr-only"
                aria-label="Show subtitles"
              />
              <span className="h-5 w-9 rounded-full bg-surface-3 transition-colors peer-checked:bg-accent peer-focus-visible:ring-4 peer-focus-visible:ring-[var(--ring)]" aria-hidden="true" />
              <span className="absolute left-0.5 size-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" aria-hidden="true" />
              <span className="w-7 text-muted">{showText ? "On" : "Off"}</span>
            </label>
          </div>
          {showText ? (
            <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Position" htmlFor="subtitlePosition" error={err.subtitlePosition}>
                <Select id="subtitlePosition" name="subtitlePosition" value={subtitle.position} onChange={setSub("position")}>
                  <option value="">Engine default</option>
                  {SUBTITLE_POSITIONS.map((v) => <option key={v} value={v}>{capitalize(v)}</option>)}
                </Select>
              </Field>
              <Field label="Animation" htmlFor="subtitleAnimation" error={err.subtitleAnimation}>
                <Select id="subtitleAnimation" name="subtitleAnimation" value={subtitle.animation} onChange={setSub("animation")}>
                  <option value="">Engine default</option>
                  {SUBTITLE_ANIMATIONS.map((v) => <option key={v} value={v}>{capitalize(v)}</option>)}
                </Select>
              </Field>
              <Field label="Background" htmlFor="subtitleBackground" error={err.subtitleBackground}>
                <Select id="subtitleBackground" name="subtitleBackground" value={subtitle.background} onChange={setSub("background")}>
                  <option value="">Engine default</option>
                  {SUBTITLE_BACKGROUNDS.map((v) => <option key={v} value={v}>{capitalize(v)}</option>)}
                </Select>
              </Field>
              <Field
                label="Font size (px)"
                htmlFor="subtitleFontSize"
                hint={`${SUBTITLE_FONT_MIN}–${SUBTITLE_FONT_MAX}. Blank uses the engine default.`}
                error={err.subtitleFontSize}
              >
                <Input
                  id="subtitleFontSize"
                  name="subtitleFontSize"
                  type="number"
                  inputMode="numeric"
                  min={SUBTITLE_FONT_MIN}
                  max={SUBTITLE_FONT_MAX}
                  step={1}
                  value={subtitle.fontSize}
                  onChange={setSub("fontSize")}
                  placeholder="Default"
                  aria-invalid={Boolean(err.subtitleFontSize)}
                />
              </Field>
              <Field label="Glow" htmlFor="subtitleGlow" error={err.subtitleGlow}>
                <Select id="subtitleGlow" name="subtitleGlow" value={subtitle.glow} onChange={setSub("glow")}>
                  <option value="">Engine default</option>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </Select>
              </Field>
              <Field label="Text color" htmlFor="subtitleColorToggle" error={err.subtitleColor}>
                <div className="flex h-10 items-center gap-3">
                  <label className="flex items-center gap-2 text-[13px] text-fg-2">
                    <input
                      id="subtitleColorToggle"
                      type="checkbox"
                      checked={customColor}
                      onChange={(e) => setCustomColor(e.target.checked)}
                      className="size-4 accent-[var(--accent)]"
                    />
                    Custom
                  </label>
                  {customColor ? (
                    <>
                      <input
                        type="color"
                        name="subtitleColor"
                        value={color}
                        onChange={(e) => setColor(e.target.value.toUpperCase())}
                        aria-label="Subtitle text color"
                        className="h-8 w-10 cursor-pointer rounded-md border border-border bg-surface p-0.5"
                      />
                      <span className="font-mono text-xs text-muted">{color}</span>
                    </>
                  ) : (
                    <span className="text-xs text-muted">Engine default</span>
                  )}
                </div>
              </Field>
            </div>
          ) : (
            <p className="px-5 py-4 text-[13px] text-muted">Subtitles will not be burned into the video. A caption file is still exported.</p>
          )}
        </Card>

        {/* 5. Music */}
        <Card>
          <div className="flex items-center gap-3 border-b border-border px-5 py-4">
            <StepNumber n={5} />
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Background music</h2>
              <p className="text-[13px] text-muted">Mixed under the narration with automatic ducking.</p>
            </div>
          </div>
          <fieldset className="space-y-3 p-5">
            <legend className="sr-only">Background music</legend>
            <input type="hidden" name="musicMode" value={musicMode} />
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                { value: "auto", label: "Automatic", hint: "The engine picks a royalty-free track that fits the title." },
                { value: "file", label: "Specific track", hint: "A file from the render engine's music library." },
              ] as const).map((o) => (
                <label
                  key={o.value}
                  className={cn(
                    "flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-accent",
                    musicMode === o.value ? "border-accent bg-accent-soft/60 ring-1 ring-accent/40" : "border-border hover:border-border-strong hover:bg-surface-2",
                  )}
                >
                  <input
                    type="radio"
                    name="musicModeChoice"
                    value={o.value}
                    checked={musicMode === o.value}
                    onChange={() => setMusicMode(o.value)}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{o.label}</span>
                    <span className="block text-xs text-muted">{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {musicMode === "file" && (
              <Field
                label="Track filename"
                htmlFor="musicFile"
                hint="Exact filename in the engine's input/bgm folder, e.g. calm-piano.mp3. If the file is not found, the video renders without music."
                error={err.musicFile}
              >
                <Input
                  id="musicFile"
                  name="musicFile"
                  value={musicFile}
                  onChange={(e) => setMusicFile(e.target.value)}
                  maxLength={255}
                  required
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="calm-piano.mp3"
                  aria-invalid={Boolean(err.musicFile)}
                />
              </Field>
            )}
          </fieldset>
        </Card>
      </div>

      {/* Summary / generate */}
      <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
        <Card className="relative overflow-hidden">
          <div className="glow absolute inset-0 opacity-70" />
          <div className="relative space-y-4 p-5">
            <div className="flex items-center gap-2">
              <Icon name="sparkles" className="text-accent" />
              <h2 className="text-[15px] font-semibold tracking-tight">Generate</h2>
            </div>

            <div className="space-y-2 text-[13px]">
              <Requirement ok={readiness.claude} label="Claude API key" href="/settings/integrations" />
              <Requirement ok={readiness.gemini} label="Gemini API key" href="/settings/integrations" />
              <Requirement ok={Boolean(selected && !selected.issue)} label="Renderable script" />
              <div className="flex items-center justify-between gap-2 rounded-lg px-1 py-1">
                <span className="flex items-center gap-2 text-fg-2">
                  <Icon name="link" size={14} className="text-muted" /> Google Drive copy
                </span>
                <span className="text-xs text-muted">{readiness.drive ? "Connected" : "Optional"}</span>
              </div>
            </div>

            {!keysReady && (
              <Alert tone="warning" title="Add your AI keys">
                Video generation uses your own Claude and Gemini keys. Add them in{" "}
                <Link href="/settings/integrations" className="font-medium underline">Integrations</Link>.
              </Alert>
            )}

            <FormMessage state={state} />

            <button type="submit" disabled={!canGenerate || pending} aria-busy={pending} className={buttonClass("primary", "lg", "w-full")}>
              {pending ? (
                <>
                  <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" /> Queuing video…
                </>
              ) : (
                <>
                  <Icon name="sparkles" /> Generate video
                </>
              )}
            </button>
            <p className="text-center text-xs text-muted">Rendering runs in the background. You can leave this page.</p>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 text-[11px] font-medium tracking-wide text-muted uppercase">Pipeline</h3>
          <ol className="space-y-3">
            {PIPELINE_STEPS.map((s, i) => (
              <li key={s.key} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-3 text-[11px] font-semibold tabular-nums text-fg-2">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{s.label}</span>
                  <span className="block text-xs text-muted">{s.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </form>
  );
}

function StepNumber({ n }: { n: number }) {
  return <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand text-[12px] font-semibold text-white">{n}</span>;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-surface px-2 py-2">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="text-[10.5px] text-muted">{hint}</dd>}
    </div>
  );
}

function Requirement({ ok, label, href }: { ok: boolean; label: string; href?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg px-1 py-1">
      <span className="flex items-center gap-2 text-fg-2">
        <span className={cn("grid size-4 place-items-center rounded-full", ok ? "bg-success text-white" : "border border-border-strong")}>
          {ok && <Icon name="check" size={10} />}
        </span>
        {label}
      </span>
      {ok ? (
        <span className="text-xs text-success">Ready</span>
      ) : href ? (
        <Link href={href} className="text-xs font-medium text-accent hover:underline">Set up</Link>
      ) : (
        <span className="text-xs text-warning">Missing</span>
      )}
    </div>
  );
}

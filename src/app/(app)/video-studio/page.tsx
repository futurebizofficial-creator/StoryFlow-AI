import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { PageContainer } from "@/components/page";
import { ButtonLink, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SubmitButton } from "@/components/form";
import { JobRow, type JobRowData } from "@/components/video-ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { VideoStudioForm, type StudioScript } from "@/components/video-studio-form";
import { createScriptAction } from "@/actions/scripts";
import { VIDEO_JOB_LIST_COLUMNS, type VideoJobListItem } from "@/lib/video/jobs";
import { isActiveJob, VIDEO_SCRIPT_MAX, VIDEO_SCRIPT_MIN } from "@/lib/video/status";
import { isUuid } from "@/lib/utils";
import { listEngineVoices } from "@/lib/video/engines";
import type { VoicePickerGroup } from "@/components/voice-picker";
import { getProvider } from "@/lib/integrations/catalog";
import { normalizeSettings, resolveScenePlan } from "@/lib/integrations/plan";
import type { StudioAiOption } from "@/components/video-studio-form";
import { analyzeScript } from "@/lib/production/director";
import { listGenerationModels } from "@/lib/integrations/model-check";
import { modelAvailability } from "@/lib/integrations/plan";
import { decryptSecret } from "@/lib/video/crypto";

export const metadata: Metadata = { title: "AI Video Studio" };

const WPM = 150;

function languageLabel(locale: string, names: Intl.DisplayNames | null) {
  try {
    return names?.of(locale) ?? locale;
  } catch {
    return locale;
  }
}

export default async function VideoStudioPage({ searchParams }: { searchParams: Promise<{ script?: string }> }) {
  const ctx = await getWorkspaceContext();
  const { script: requested } = await searchParams;
  const supabase = await createClient();
  const wsId = ctx.current.workspace.id;

  const [scriptsRes, credsRes, driveRes, jobsRes, voiceCatalog, settingsRes, disabledRes] = await Promise.all([
    supabase
      .from("scripts")
      .select("id,title,content,tone,target_duration_seconds,updated_at")
      .eq("workspace_id", wsId)
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase.from("workspace_provider_credentials").select("provider").eq("workspace_id", wsId).eq("user_id", ctx.user.id),
    supabase.from("google_drive_connections").select("email").eq("user_id", ctx.user.id).maybeSingle(),
    supabase
      .from("video_jobs")
      .select(VIDEO_JOB_LIST_COLUMNS)
      .eq("workspace_id", wsId)
      .order("created_at", { ascending: false })
      .limit(5),
    // Server-only call to AVG GET /api/voices (cached for an hour); never exposes the engine URL or token.
    listEngineVoices(),
    supabase.from("workspace_generation_settings").select("free_mode, ai_providers, ai_models").eq("workspace_id", wsId).maybeSingle(),
    supabase.from("workspace_integrations").select("provider").eq("workspace_id", wsId).eq("enabled", false),
  ]);

  const scripts: StudioScript[] = (scriptsRes.data ?? []).map((s) => {
    const text = s.content.trim();
    const words = text ? text.split(/\s+/).length : 0;
    const chars = s.content.length;
    const issue =
      text.length < VIDEO_SCRIPT_MIN
        ? `Needs at least ${VIDEO_SCRIPT_MIN} characters`
        : chars > VIDEO_SCRIPT_MAX
          ? `${chars.toLocaleString()} / ${VIDEO_SCRIPT_MAX.toLocaleString()} characters — too long to render`
          : null;
    return {
      id: s.id,
      title: s.title,
      tone: s.tone,
      targetDuration: s.target_duration_seconds,
      words,
      chars,
      estimatedSeconds: (words / WPM) * 60,
      excerpt: text.slice(0, 280),
      issue,
      updatedAt: s.updated_at,
      analysis: analyzeScript(s.content),
    };
  });

  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(["en"], { type: "language" });
  } catch {}
  const voiceGroups: VoicePickerGroup[] | null =
    voiceCatalog.status === "ok"
      ? voiceCatalog.groups
          .map((g) => ({ locale: g.locale, label: `${languageLabel(g.locale, names)} (${g.locale})`, voices: g.voices }))
          .sort((a, b) => a.label.localeCompare(b.label))
      : null;

  const providers = new Set((credsRes.data ?? []).map((c) => c.provider));
  // A read error is reported, not replaced with the Claude default.
  const settingsError = settingsRes.error?.message ?? null;
  const genSettings = settingsError ? { freeMode: false, aiProviders: [], aiModels: {}, isDefault: false } : normalizeSettings(settingsRes.data);
  const disabledProviders = new Set((disabledRes.data ?? []).map((r) => r.provider));
  // Availability of each configured scene-planning provider for this user (same rules the action enforces).
  // Integration Validation: for each provider this setup could use, check now (server-side, with
  // the user's own key) that the key works and the saved model is offered. Listing models is free.
  const validateIds = Array.from(new Set([...genSettings.aiProviders.filter((id) => providers.has(id)), ...(providers.has("gemini") ? ["gemini"] : [])]));
  const validation = new Map<string, { ok: boolean; error: string | null }>();
  if (validateIds.length) {
    const { data: creds } = await supabase
      .from("workspace_provider_credentials")
      .select("provider,ciphertext,nonce,auth_tag")
      .eq("workspace_id", wsId)
      .eq("user_id", ctx.user.id)
      .in("provider", validateIds);
    await Promise.all(
      validateIds.map(async (id) => {
        const cred = (creds ?? []).find((c) => c.provider === id);
        let key: string | null = null;
        try {
          key = cred ? decryptSecret(cred) : null;
        } catch {}
        if (!key) return validation.set(id, { ok: false, error: "The saved key could not be read. Save it again in Integrations." });
        const live = await listGenerationModels(id, key);
        if (!live.ok) return validation.set(id, { ok: false, error: live.error ?? "Could not verify the key." });
        const model = genSettings.aiModels[id];
        if (model && genSettings.aiProviders.includes(id)) {
          const available = modelAvailability(id, model, live.models);
          if (!available.ok) return validation.set(id, { ok: false, error: available.message });
        }
        validation.set(id, { ok: true, error: null });
      }),
    );
  }

  const aiOptions: StudioAiOption[] = genSettings.aiProviders.map((id) => {
    const plan = resolveScenePlan({ settings: genSettings, primary: id, keys: providers, disabled: disabledProviders });
    const def = getProvider(id);
    const check = validation.get(id);
    return {
      id,
      name: def?.name ?? id,
      pricing: def?.pricing ?? "paid",
      model: genSettings.aiModels[id] ?? null,
      available: plan.ok,
      validated: plan.ok && check?.ok === true,
      reason: plan.ok ? (check && !check.ok ? check.error : null) : plan.error,
      chain: plan.ok
        ? plan.providers
            .filter((p) => validation.get(p.id)?.ok === true)
            .map((p) => ({ id: p.id, name: getProvider(p.id)?.name ?? p.id, paid: p.paid }))
        : [],
    };
  });
  const gemini = validation.get("gemini");
  const jobs = (jobsRes.data ?? []) as unknown as VideoJobListItem[];
  const initialScriptId = isUuid(requested) && scripts.some((s) => s.id === requested) ? requested : (scripts.find((s) => !s.issue)?.id ?? "");

  return (
    <PageContainer>
      <AutoRefresh active={jobs.some((j) => isActiveJob(j.status))} />
      <PageHeader
        eyebrow="AI Video Studio"
        title="Turn a script into a finished video"
        description="Your chosen AI provider plans the scenes, Gemini creates a consistent character, and the render engine produces a narrated, captioned MP4."
        actions={
          <ButtonLink href="/videos" variant="outline">
            <Icon name="film" /> My Videos
          </ButtonLink>
        }
      />

      {scriptsRes.error ? (
        <Card className="p-6 text-sm text-danger">Could not load scripts: {scriptsRes.error.message}</Card>
      ) : scripts.length === 0 ? (
        <Card>
          <EmptyState
            icon="pen"
            title="Write a script first"
            description="Videos are generated from scripts in this workspace. Create one in Script Studio, then come back to render it."
            action={
              <form action={createScriptAction}>
                <SubmitButton pendingText="Creating…">
                  <Icon name="plus" /> New script
                </SubmitButton>
              </form>
            }
          />
        </Card>
      ) : (
        <VideoStudioForm
          scripts={scripts}
          initialScriptId={initialScriptId}
          voiceGroups={voiceGroups}
          voiceStatus={voiceCatalog.status}
          readiness={{ gemini: providers.has("gemini"), drive: driveRes.data ? (driveRes.data.email ?? "connected") : null }}
          ai={{
            freeMode: genSettings.freeMode,
            options: aiOptions,
            canManage: ctx.canManage,
            isDefault: genSettings.isDefault === true,
            loadError: settingsError,
            geminiValidated: gemini?.ok === true,
            geminiError: providers.has("gemini") ? (gemini?.error ?? null) : "No Gemini API key saved.",
          }}
        />
      )}

      {jobs.length > 0 && (
        <Card className="mt-8">
          <CardHeader
            title="Recent generations"
            description="Progress updates automatically while a video is rendering."
            action={
              <ButtonLink href="/videos" variant="ghost" size="sm">
                View all <Icon name="arrowRight" size={14} />
              </ButtonLink>
            }
          />
          <ul className="divide-y divide-border">
            {jobs.map((j) => (
              <li key={j.id}>
                <JobRow job={j as JobRowData} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </PageContainer>
  );
}

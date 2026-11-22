import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { getIntegration } from "@/lib/integrations";
import { PROVIDERS } from "@/lib/integrations/catalog";
import { normalizeSettings } from "@/lib/integrations/plan";
import { PageContainer } from "@/components/page";
import { PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { IntegrationsHub } from "@/components/integrations-hub";
import { IntegrationCard } from "@/components/integration-card";

export const metadata: Metadata = { title: "Integrations" };

const DRIVE_NOTICES: Record<string, { tone: "success" | "danger"; text: string }> = {
  state_error: { tone: "danger", text: "Google Drive connection expired or was tampered with. Please try again." },
  denied: { tone: "danger", text: "Google Drive access was not granted." },
  not_configured: { tone: "danger", text: "Google Drive is not configured on this server." },
  token_error: { tone: "danger", text: "Google did not return a valid token. Please try again." },
  save_error: { tone: "danger", text: "The Google Drive connection could not be saved." },
};

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ drive?: string }> }) {
  const ctx = await getWorkspaceContext();
  const { drive: driveStatus } = await searchParams;
  const supabase = await createClient();
  const wsId = ctx.current.workspace.id;

  const [{ data: keys }, { data: rows }, { data: settingsRow }, { data: drive }] = await Promise.all([
    // Provider names only — ciphertext never leaves the database here.
    supabase.from("workspace_provider_credentials").select("provider").eq("workspace_id", wsId).eq("user_id", ctx.user.id),
    supabase.from("workspace_integrations").select("provider, enabled, settings").eq("workspace_id", wsId),
    supabase.from("workspace_generation_settings").select("free_mode, ai_providers, ai_models").eq("workspace_id", wsId).maybeSingle(),
    supabase.from("google_drive_connections").select("email").eq("user_id", ctx.user.id).maybeSingle(),
  ]);

  const webhook = getIntegration("webhook");
  const webhookRow = (rows ?? []).find((r) => r.provider === "webhook");

  return (
    <PageContainer className="max-w-7xl">
      <PageHeader
        eyebrow="Settings"
        title="Integrations Hub"
        description="Connect AI models, voice, stock media, creative tools, publishing and storage. Your API keys are encrypted on the server and only used for your own renders."
        actions={
          <Link href="/settings/integrations/stock" className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-border-strong bg-surface px-3.5 text-sm font-medium hover:bg-surface-2">
            <Icon name="search" /> Stock media search
          </Link>
        }
      />
      <IntegrationsHub
        providers={PROVIDERS}
        savedKeys={(keys ?? []).map((k) => k.provider)}
        disabled={(rows ?? []).filter((r) => r.enabled === false && r.provider !== "webhook").map((r) => r.provider)}
        canManage={ctx.canManage}
        settings={normalizeSettings(settingsRow)}
        drive={{ connected: Boolean(drive), email: drive?.email ?? null, configured: Boolean(process.env.GOOGLE_CLIENT_ID) }}
        notice={driveStatus ? (DRIVE_NOTICES[driveStatus] ?? null) : null}
      />

      {webhook && (
        <section className="mt-10 space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Automation</h2>
            <p className="text-sm text-muted">Workspace notifications. Event delivery ships in a later release.</p>
          </div>
          <div className="max-w-xl">
            <IntegrationCard
              definition={webhook}
              credentialPresent={false}
              enabled={webhookRow?.enabled ?? false}
              settings={(webhookRow?.settings as Record<string, string> | undefined) ?? {}}
              canManage={ctx.canManage}
            />
          </div>
        </section>
      )}
    </PageContainer>
  );
}

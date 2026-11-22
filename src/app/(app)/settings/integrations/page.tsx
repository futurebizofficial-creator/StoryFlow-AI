import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { INTEGRATIONS } from "@/lib/integrations";
import { hasServerEnv } from "@/lib/env";
import { PageContainer } from "@/components/page";
import { Alert, PageHeader } from "@/components/ui";
import { IntegrationCard } from "@/components/integration-card";
import type { WorkspaceIntegration } from "@/lib/types";
import { ProviderCredentials } from "@/components/provider-credentials";
import { disconnectDriveAction } from "@/actions/video";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const ctx = await getWorkspaceContext();
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspace_integrations")
    .select("provider, enabled, settings, updated_at")
    .eq("workspace_id", ctx.current.workspace.id);

  const saved = new Map(((data ?? []) as WorkspaceIntegration[]).map((i) => [i.provider, i]));
  const { data: credentials } = await supabase.from("workspace_provider_credentials")
    .select("provider").eq("workspace_id", ctx.current.workspace.id).eq("user_id", ctx.user.id);
  const { data: drive } = await supabase.from("google_drive_connections")
    .select("email,connected_at").eq("user_id", ctx.user.id).maybeSingle();

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Settings"
        title="Integrations"
        description="Configure workspace integrations, private BYOK credentials and your personal Drive connection."
      />
      <ProviderCredentials configured={(credentials ?? []).map((row) => row.provider)} />
      <section className="mb-8 rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold">Personal Google Drive</h2>
        <p className="mt-1 text-sm text-muted">{drive ? `Connected${drive.email ? ` as ${drive.email}` : ""}. Video exports can be saved to this account.` : "Connect your own Drive account for private export delivery."}</p>
        {process.env.GOOGLE_CLIENT_ID ? <a className="mt-4 inline-flex rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-2" href="/api/integrations/google-drive/connect">{drive ? "Reconnect Drive" : "Connect Google Drive"}</a> : <p className="mt-3 text-xs text-muted">Set Google OAuth client credentials to enable Drive connections.</p>}
        {drive && <form action={disconnectDriveAction} className="mt-3"><button className="text-xs text-danger hover:underline" type="submit">Disconnect this Drive account</button></form>}
      </section>
      <div className="mb-6 space-y-3">
        <Alert tone="neutral" title="Provider keys stay private">
          AI requests run on the video worker. Claude and Gemini keys are encrypted at rest and scoped to your account;
          workspace integration preferences remain available to workspace admins.
        </Alert>
        {!ctx.canManage && <Alert tone="neutral">Only owners and admins can change integration settings.</Alert>}
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {INTEGRATIONS.map((def) => {
          const row = saved.get(def.provider);
          return (
            <IntegrationCard
              key={def.provider}
              definition={def}
              credentialPresent={hasServerEnv(def.envVars) || (def.provider === "anthropic" && (credentials ?? []).some((row) => row.provider === "anthropic"))}
              enabled={row?.enabled ?? false}
              settings={row?.settings ?? {}}
              canManage={ctx.canManage}
            />
          );
        })}
      </div>
    </PageContainer>
  );
}

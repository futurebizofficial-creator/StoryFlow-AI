import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Logo, Icon } from "@/components/icons";
import { Alert, ButtonLink, Card } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { SetupRequired } from "@/components/setup-required";
import { acceptInvitationAction } from "@/actions/workspace";
import { isSupabaseConfigured } from "@/lib/env";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, isUuid, ROLE_LABEL } from "@/lib/utils";
import type { WorkspaceRole } from "@/lib/types";

export const metadata: Metadata = { title: "Workspace invitation" };

interface InvitationDetails {
  workspace_id: string;
  workspace_name: string;
  email: string;
  role: WorkspaceRole;
  status: "pending" | "accepted" | "revoked";
  expires_at: string;
  invited_by_name: string | null;
}

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await connection();
  if (!isSupabaseConfigured()) return <SetupRequired />;

  const { token } = await params;
  const { error } = await searchParams;
  const user = await getUser();
  const next = `/invite/${token}`;

  let invitation: InvitationDetails | null = null;
  if (user && isUuid(token)) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("get_invitation", { _token: token });
    invitation = ((data ?? []) as InvitationDetails[])[0] ?? null;
  }

  const expired = invitation ? new Date(invitation.expires_at) < new Date() : false;
  const emailMismatch = invitation && user ? invitation.email !== (user.email ?? "").toLowerCase() : false;

  return (
    <div className="glow grid min-h-dvh place-items-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <Card className="p-7">
          <div className="mb-5 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
            <Icon name="users" size={22} />
          </div>

          {!user ? (
            <>
              <h1 className="text-xl font-semibold tracking-tight">You&apos;ve been invited to StoryFlow</h1>
              <p className="mt-2 text-sm text-muted">
                Sign in or create an account with the email address this invitation was sent to.
              </p>
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                <ButtonLink href={`/login?next=${encodeURIComponent(next)}`} variant="outline">
                  Sign in
                </ButtonLink>
                <ButtonLink href={`/signup?invite=${encodeURIComponent(token)}`}>Create account</ButtonLink>
              </div>
            </>
          ) : !invitation ? (
            <>
              <h1 className="text-xl font-semibold tracking-tight">Invitation not found</h1>
              <p className="mt-2 text-sm text-muted">This link is invalid or the invitation was removed.</p>
              <ButtonLink href="/dashboard" className="mt-6" variant="outline">
                Go to dashboard
              </ButtonLink>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold tracking-tight">Join {invitation.workspace_name}</h1>
              <p className="mt-2 text-sm text-muted">
                {invitation.invited_by_name ?? "A teammate"} invited <span className="font-medium text-fg">{invitation.email}</span>{" "}
                to join as <span className="font-medium text-fg">{ROLE_LABEL[invitation.role]}</span>.
              </p>
              <p className="mt-1 text-xs text-muted">Expires {formatDate(invitation.expires_at)}</p>

              <div className="mt-5 space-y-3">
                {error && <Alert tone="danger">{error}</Alert>}
                {invitation.status !== "pending" && (
                  <Alert tone="warning">This invitation has already been {invitation.status}.</Alert>
                )}
                {expired && invitation.status === "pending" && (
                  <Alert tone="warning">This invitation has expired. Ask the workspace owner to send a new one.</Alert>
                )}
                {emailMismatch && (
                  <Alert tone="warning">
                    You&apos;re signed in as {user.email}. Sign in with {invitation.email} to accept.
                  </Alert>
                )}
              </div>

              {invitation.status === "pending" && !expired && !emailMismatch ? (
                <form action={acceptInvitationAction} className="mt-6">
                  <input type="hidden" name="token" value={token} />
                  <SubmitButton size="lg" className="w-full" pendingText="Joining…">
                    Accept invitation
                  </SubmitButton>
                </form>
              ) : (
                <Link href="/dashboard" className="mt-6 inline-block text-sm font-medium text-accent hover:underline">
                  Go to dashboard
                </Link>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

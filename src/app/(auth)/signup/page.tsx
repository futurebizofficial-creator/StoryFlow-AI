import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth-forms";
import { Alert, ButtonLink } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { isUuid } from "@/lib/utils";

export const metadata: Metadata = { title: "Accept invitation" };

/**
 * StoryFlow is invite-only. The signup form is shown only for a usable invitation token
 * (?invite=<token>); everyone else is sent to sign in. Only a yes/no validity check is made
 * here, so no invitation details are revealed.
 */
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  if (!isUuid(invite)) redirect("/login");

  let valid = false;
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("signup_invitation_is_valid", { _token: invite });
    valid = data === true;
  }

  if (!valid) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Invitation unavailable</h1>
        <p className="mt-1.5 text-sm text-muted">StoryFlow accounts are created by invitation only.</p>
        <div className="mt-6">
          <Alert tone="warning">
            This invitation link is invalid, has expired or has been revoked. Ask the workspace owner to send you a new one.
          </Alert>
        </div>
        <ButtonLink href="/login" variant="outline" className="mt-6 w-full">
          Go to sign in
        </ButtonLink>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1.5 text-sm text-muted">
        You&apos;ve been invited to StoryFlow. Use the email address the invitation was sent to.
      </p>
      <div className="mt-7">
        <SignupForm invitationToken={invite} />
      </div>
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href={`/login?next=${encodeURIComponent(`/invite/${invite}`)}`} className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

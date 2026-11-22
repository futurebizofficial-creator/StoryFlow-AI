import type { Metadata } from "next";
import { LoginForm } from "@/components/auth-forms";
import { Alert } from "@/components/ui";
import { safeNextPath } from "@/lib/utils";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; reset?: string }>;
}) {
  const { next, error } = await searchParams;
  const nextPath = safeNextPath(next);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1.5 text-sm text-muted">Sign in to continue to your workspace.</p>
      {error && (
        <div className="mt-5">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <div className="mt-7">
        <LoginForm next={nextPath} />
      </div>
      <p className="mt-6 text-center text-sm text-muted">
        StoryFlow is invite-only. New accounts are created from an invitation link sent by a workspace owner.
      </p>
    </div>
  );
}

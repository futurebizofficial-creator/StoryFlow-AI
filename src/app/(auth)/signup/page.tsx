import Link from "next/link";
import type { Metadata } from "next";
import { SignupForm } from "@/components/auth-forms";
import { safeNextPath } from "@/lib/utils";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(next);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1.5 text-sm text-muted">Start writing with your team in minutes.</p>
      <div className="mt-7">
        <SignupForm next={nextPath} />
      </div>
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link
          href={nextPath !== "/dashboard" ? `/login?next=${encodeURIComponent(nextPath)}` : "/login"}
          className="font-medium text-accent hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}

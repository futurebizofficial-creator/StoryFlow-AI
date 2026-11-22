import Link from "next/link";
import type { Metadata } from "next";
import { ResendVerificationForm } from "@/components/auth-forms";
import { Icon } from "@/components/icons";

export const metadata: Metadata = { title: "Verify your email" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; unconfirmed?: string }>;
}) {
  const { email = "", unconfirmed } = await searchParams;

  return (
    <div>
      <div className="mb-6 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
        <Icon name="mail" size={22} />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">
        {unconfirmed ? "Verify your email first" : "Check your inbox"}
      </h1>
      <p className="mt-1.5 text-sm text-muted">
        {unconfirmed
          ? "Your account exists but the email address hasn't been confirmed yet."
          : "We sent a verification link to"}{" "}
        {!unconfirmed && email && <span className="font-medium text-fg">{email}</span>}
        {!unconfirmed && ". Click it to activate your account."}
      </p>
      <div className="mt-7 rounded-2xl border border-border bg-surface p-5">
        <p className="mb-4 text-[13px] text-muted">Didn&apos;t get the email? Check spam, or send it again.</p>
        <ResendVerificationForm email={email} />
      </div>
      <p className="mt-6 text-center text-sm text-muted">
        Already verified?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

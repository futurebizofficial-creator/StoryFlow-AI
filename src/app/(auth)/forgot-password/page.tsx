import Link from "next/link";
import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth-forms";
import { Icon } from "@/components/icons";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <div>
      <Link href="/login" className="mb-6 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <Icon name="chevronLeft" size={14} /> Back to sign in
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1.5 text-sm text-muted">
        Enter the email you signed up with and we&apos;ll send you a secure reset link.
      </p>
      <div className="mt-7">
        <ForgotPasswordForm />
      </div>
    </div>
  );
}

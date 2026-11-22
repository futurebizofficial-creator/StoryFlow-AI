import Link from "next/link";
import type { Metadata } from "next";
import { UpdatePasswordForm } from "@/components/auth-forms";
import { Alert } from "@/components/ui";
import { getUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function UpdatePasswordPage() {
  const user = await getUser();

  if (!user) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Link expired</h1>
        <div className="mt-5">
          <Alert tone="warning">
            This password reset session is no longer valid. Request a new link to continue.
          </Alert>
        </div>
        <Link href="/forgot-password" className="mt-5 inline-block text-sm font-medium text-accent hover:underline">
          Request a new reset link
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1.5 text-sm text-muted">
        Updating the password for <span className="font-medium text-fg">{user.email}</span>.
      </p>
      <div className="mt-7">
        <UpdatePasswordForm />
      </div>
    </div>
  );
}

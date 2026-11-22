"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  forgotPasswordAction,
  resendVerificationAction,
  signInAction,
  signUpAction,
  updatePasswordAction,
} from "@/actions/auth";
import { Field, Input } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form";
import type { ActionState } from "@/lib/types";

const initial: ActionState = {};

function PasswordInput({ id, name, autoComplete, placeholder }: { id: string; name: string; autoComplete: string; placeholder?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required
        minLength={name === "password" && autoComplete === "current-password" ? undefined : 8}
        className="pr-16"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-muted hover:text-fg"
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(signInAction, initial);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
      </Field>
      <Field
        label="Password"
        htmlFor="password"
        aside={
          <Link href="/forgot-password" className="text-xs font-medium text-accent hover:underline">
            Forgot password?
          </Link>
        }
      >
        <PasswordInput id="password" name="password" autoComplete="current-password" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton size="lg" className="w-full" pendingText="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}

export function SignupForm({ invitationToken }: { invitationToken: string }) {
  const [state, action] = useActionState(signUpAction, initial);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="invitationToken" value={invitationToken} />
      <Field label="Full name" htmlFor="fullName" error={state.fieldErrors?.fullName}>
        <Input id="fullName" name="fullName" autoComplete="name" placeholder="Ada Lovelace" required />
      </Field>
      <Field label="Invited email" htmlFor="email" error={state.fieldErrors?.email} hint="Must match the address your invitation was sent to.">
        <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
      </Field>
      <Field label="Password" htmlFor="password" error={state.fieldErrors?.password} hint="At least 8 characters.">
        <PasswordInput id="password" name="password" autoComplete="new-password" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton size="lg" className="w-full" pendingText="Creating account…">
        Create account
      </SubmitButton>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(forgotPasswordAction, initial);
  return (
    <form action={action} className="space-y-4">
      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton size="lg" className="w-full" pendingText="Sending…">
        Send reset link
      </SubmitButton>
    </form>
  );
}

export function UpdatePasswordForm() {
  const [state, action] = useActionState(updatePasswordAction, initial);
  return (
    <form action={action} className="space-y-4">
      <Field label="New password" htmlFor="password" error={state.fieldErrors?.password} hint="At least 8 characters.">
        <PasswordInput id="password" name="password" autoComplete="new-password" />
      </Field>
      <Field label="Confirm password" htmlFor="confirm" error={state.fieldErrors?.confirm}>
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton size="lg" className="w-full" pendingText="Updating…">
        Update password
      </SubmitButton>
    </form>
  );
}

export function ResendVerificationForm({ email }: { email: string }) {
  const [state, action] = useActionState(resendVerificationAction, initial);
  return (
    <form action={action} className="space-y-3">
      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" defaultValue={email} autoComplete="email" required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="outline" className="w-full" pendingText="Sending…">
        Resend verification email
      </SubmitButton>
    </form>
  );
}

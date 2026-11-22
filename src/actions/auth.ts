"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrigin } from "@/lib/origin";
import { safeNextPath } from "@/lib/utils";
import { WORKSPACE_COOKIE } from "@/lib/workspace";
import type { ActionState } from "@/lib/types";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function readEmail(formData: FormData) {
  return String(formData.get("email") ?? "").trim().toLowerCase();
}

export async function signUpAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = readEmail(formData);
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(formData.get("next"), "/dashboard");

  const fieldErrors: Record<string, string> = {};
  if (fullName.length < 2) fieldErrors.fullName = "Enter your full name.";
  if (!EMAIL_RE.test(email)) fieldErrors.email = "Enter a valid email address.";
  if (password.length < 8) fieldErrors.password = "Use at least 8 characters.";
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const supabase = await createClient();
  const origin = await getOrigin();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) return { error: error.message };

  // Email confirmation disabled in Supabase → a session is returned immediately.
  if (data.session) redirect(next);

  redirect(`/verify-email?email=${encodeURIComponent(email)}`);
}

export async function signInAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const email = readEmail(formData);
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(formData.get("next"));

  if (!EMAIL_RE.test(email) || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.code === "email_not_confirmed") {
      redirect(`/verify-email?email=${encodeURIComponent(email)}&unconfirmed=1`);
    }
    return { error: error.code === "invalid_credentials" ? "Incorrect email or password." : error.message };
  }

  redirect(next);
}

export async function resendVerificationAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = readEmail(formData);
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };

  const supabase = await createClient();
  const origin = await getOrigin();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${origin}/auth/confirm?next=/dashboard` },
  });
  if (error) return { error: error.message };
  return { success: "Verification email sent. Check your inbox." };
}

export async function forgotPasswordAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = readEmail(formData);
  if (!EMAIL_RE.test(email)) return { fieldErrors: { email: "Enter a valid email address." } };

  const supabase = await createClient();
  const origin = await getOrigin();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=/update-password`,
  });

  // Rate limits are worth surfacing; everything else gets a neutral answer so
  // the form cannot be used to discover which emails have accounts.
  if (error && error.status === 429) return { error: "Too many requests. Try again in a minute." };
  return {
    success: "If an account exists for that email, a password reset link is on its way.",
  };
}

export async function updatePasswordAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8) return { fieldErrors: { password: "Use at least 8 characters." } };
  if (password !== confirm) return { fieldErrors: { confirm: "Passwords do not match." } };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your reset link has expired. Request a new one." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  redirect("/dashboard?password=updated");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(WORKSPACE_COOKIE);
  redirect("/login");
}

import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/utils";

const OTP_TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Handles links from Supabase auth emails (verification, password recovery).
 * Supports both the PKCE `code` flow and the `token_hash` flow.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const fail = (message: string) => {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", message);
    return NextResponse.redirect(url);
  };

  try {
    const supabase = await createClient();

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) return fail("This link is invalid or has expired. Please request a new one.");
    } else if (tokenHash && type && OTP_TYPES.includes(type)) {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      if (error) return fail("This link is invalid or has expired. Please request a new one.");
    } else {
      const authError = searchParams.get("error_description");
      return fail(authError ?? "Missing verification token.");
    }
  } catch {
    return fail("Authentication is not configured on this server.");
  }

  const destination = type === "recovery" && next === "/dashboard" ? "/update-password" : next;
  return NextResponse.redirect(new URL(destination, request.url));
}

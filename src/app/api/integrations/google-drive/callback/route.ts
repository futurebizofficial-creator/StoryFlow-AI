import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret, decryptSecret } from "@/lib/video/crypto";

export async function GET(request: Request) {
  const user = await requireUser();
  const url = new URL(request.url);
  const store = await cookies();
  const expected = store.get("sf_google_oauth_state")?.value ?? "";
  const actual = url.searchParams.get("state") ?? "";
  const response = NextResponse.redirect(new URL("/settings/integrations", url.origin));
  response.cookies.delete("sf_google_oauth_state");
  if (!expected || expected.length !== actual.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) {
    response.headers.set("Location", new URL("/settings/integrations?drive=state_error", url.origin).toString());
    return response;
  }
  if (url.searchParams.has("error")) {
    response.headers.set("Location", new URL("/settings/integrations?drive=denied", url.origin).toString());
    return response;
  }
  const code = url.searchParams.get("code");
  if (!code || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    response.headers.set("Location", new URL("/settings/integrations?drive=not_configured", url.origin).toString());
    return response;
  }
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || new URL("/api/integrations/google-drive/callback", url.origin).toString();
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: "authorization_code" }), cache: "no-store" });
  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok || !tokens.access_token) {
    response.headers.set("Location", new URL("/settings/integrations?drive=token_error", url.origin).toString());
    return response;
  }
  const supabase = await createClient();
  const { data: previous } = await supabase.from("google_drive_connections").select("ciphertext,nonce,auth_tag").eq("user_id", user.id).maybeSingle();
  const prior = previous ? JSON.parse(decryptSecret(previous)) : {};
  const sealed = encryptSecret(JSON.stringify({ refresh_token: tokens.refresh_token || prior.refresh_token }));
  const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` }, cache: "no-store" });
  const profile = profileResponse.ok ? await profileResponse.json() : {};
  const { error } = await supabase.from("google_drive_connections").upsert({ user_id: user.id, ...sealed, email: profile.email ?? null });
  if (error) response.headers.set("Location", new URL("/settings/integrations?drive=save_error", url.origin).toString());
  return response;
}

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export async function GET(request: Request) {
  await requireUser();
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return new NextResponse("Google Drive is not configured", { status: 503 });
  const state = randomBytes(32).toString("hex");
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || new URL("/api/integrations/google-drive/callback", request.url).toString();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  const response = NextResponse.redirect(url);
  response.cookies.set("sf_google_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  return response;
}

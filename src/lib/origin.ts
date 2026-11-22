import "server-only";
import { headers } from "next/headers";
import { getConfiguredSiteUrl } from "@/lib/env";

/** Public origin for links in auth emails and invitations. */
export async function getOrigin() {
  const configured = getConfiguredSiteUrl();
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

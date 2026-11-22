import { NextResponse } from "next/server";
import { getSupabaseEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const startedAt = Date.now();

/**
 * Liveness/readiness probe used by Render. Always returns 200 while the
 * process is serving requests; `status` reports degraded dependencies.
 * Exposes no secrets — only whether configuration is present.
 */
export async function GET() {
  const env = getSupabaseEnv();
  let database: "ok" | "unreachable" | "not_configured" = "not_configured";
  let latencyMs: number | null = null;

  if (env) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${env.url}/auth/v1/health`, {
        headers: { apikey: env.anonKey },
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      });
      database = res.ok ? "ok" : "unreachable";
    } catch {
      database = "unreachable";
    }
    latencyMs = Date.now() - t0;
  }

  return NextResponse.json(
    {
      status: database === "ok" ? "ok" : "degraded",
      service: "storyflow-ai",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      checks: {
        supabaseConfigured: Boolean(env),
        supabase: database,
        supabaseLatencyMs: latencyMs,
      },
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

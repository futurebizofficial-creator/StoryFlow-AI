/**
 * Reads an environment variable at request time. Dynamic lookups are not
 * inlined by `next build`, so values can change without a rebuild.
 * (Only server code imports this module.)
 */
function readEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Supabase project URL and anon/publishable key. The anon key is designed to
 * be public; data access is protected by Row Level Security.
 * No service-role key is used anywhere in this application.
 */
export function getSupabaseEnv(): { url: string; anonKey: string } | null {
  const url = readEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL");
  const anonKey = readEnv(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
  );
  if (!url || !anonKey) return null;
  return { url: url.replace(/\/+$/, ""), anonKey };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseEnv() !== null;
}

/** Absolute site URL used in auth emails and invite links. Falls back to the request origin. */
export function getConfiguredSiteUrl(): string | null {
  const url = readEnv("NEXT_PUBLIC_SITE_URL", "SITE_URL", "RENDER_EXTERNAL_URL");
  return url ? url.replace(/\/+$/, "") : null;
}

/** True when every named server-only variable is set (values are never returned). */
export function hasServerEnv(names: string[]): boolean {
  return names.length > 0 && names.every((n) => Boolean(readEnv(n)));
}

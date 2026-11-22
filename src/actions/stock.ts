"use server";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { decryptSecret } from "@/lib/video/crypto";
import { extractKeywords, type StockMediaType, type StockOrientation, type StockProviderId, type StockResult } from "@/lib/integrations/stock";
import { searchStock } from "@/lib/integrations/stock-search";

const PROVIDERS: StockProviderId[] = ["pexels", "pixabay", "unsplash", "wikimedia", "internet_archive"];

export interface StockSearchState {
  error?: string;
  keywords?: string[];
  results?: StockResult[];
  errors?: Array<{ provider: string; message: string }>;
}

/** Searches official stock APIs with the caller's own keys. Respects workspace-disabled providers. */
export async function searchStockAction(_: StockSearchState, formData: FormData): Promise<StockSearchState> {
  const ctx = await getWorkspaceContext();
  const text = String(formData.get("query") ?? "").slice(0, 2000);
  const keywords = extractKeywords(text);
  if (keywords.length === 0) return { error: "Enter a few descriptive words or paste a scene to search for." };

  const mediaType = String(formData.get("mediaType") ?? "photo") as StockMediaType;
  if (mediaType !== "photo" && mediaType !== "video") return { error: "Choose photos or videos." };
  const orientationRaw = String(formData.get("orientation") ?? "");
  const orientation = (["landscape", "portrait", "square"] as const).find((o) => o === orientationRaw) ?? null;
  const minDuration = Number(formData.get("minDuration") ?? "") || null;
  const maxDuration = Number(formData.get("maxDuration") ?? "") || null;
  if ((minDuration && (minDuration < 0 || minDuration > 3600)) || (maxDuration && (maxDuration < 1 || maxDuration > 3600))) {
    return { error: "Durations must be between 0 and 3600 seconds." };
  }
  const requested = formData.getAll("providers").map(String).filter((p): p is StockProviderId => PROVIDERS.includes(p as StockProviderId));
  if (requested.length === 0) return { error: "Choose at least one stock provider." };

  const supabase = await createClient();
  const { data: disabledRows } = await supabase
    .from("workspace_integrations")
    .select("provider")
    .eq("workspace_id", ctx.current.workspace.id)
    .eq("enabled", false);
  const disabled = new Set((disabledRows ?? []).map((r) => r.provider));
  const providers = requested.filter((p) => !disabled.has(p));
  const skipped = requested.filter((p) => disabled.has(p)).map((p) => ({ provider: p, message: "Disabled for this workspace." }));

  const outcome = await searchStock(
    { keywords, mediaType, orientation: orientation as StockOrientation | null, minDuration, maxDuration },
    providers,
    async (provider) => {
      const { data } = await supabase
        .from("workspace_provider_credentials")
        .select("ciphertext,nonce,auth_tag")
        .eq("workspace_id", ctx.current.workspace.id)
        .eq("user_id", ctx.user.id)
        .eq("provider", provider)
        .maybeSingle();
      if (!data) return null;
      try {
        return decryptSecret(data);
      } catch {
        return null;
      }
    },
  );
  return { keywords, results: outcome.results, errors: [...skipped, ...outcome.errors] };
}

import "server-only";
import {
  mapInternetArchive,
  mapPexels,
  mapPixabay,
  mapUnsplash,
  mapWikimedia,
  rankResults,
  STOCK_CACHE_TTL_MS,
  STOCK_SUPPORTS,
  type StockMediaType,
  type StockOrientation,
  type StockProviderId,
  type StockQuery,
  type StockResult,
} from "@/lib/integrations/stock";

/**
 * Official search APIs only (no scraping). Keys are the caller's own decrypted keys and are
 * only sent to the provider's API host. Results are cached in memory for the provider's
 * required/allowed lifetime; media is never downloaded here.
 */

const USER_AGENT = "StoryFlowAI/1.0 (stock media search)";
const cache = new Map<string, { expires: number; results: StockResult[] }>();

function request(
  provider: StockProviderId,
  q: string,
  mediaType: StockMediaType,
  orientation: StockOrientation | null,
  key: string | null,
): { url: string; headers?: Record<string, string> } {
  const query = encodeURIComponent(q.slice(0, 100));
  switch (provider) {
    case "pexels": {
      const o = orientation ? `&orientation=${orientation}` : "";
      const url = mediaType === "video" ? `https://api.pexels.com/videos/search?query=${query}&per_page=20${o}` : `https://api.pexels.com/v1/search?query=${query}&per_page=20${o}`;
      return { url, headers: { Authorization: key ?? "" } };
    }
    case "pixabay": {
      const o = orientation === "landscape" ? "&orientation=horizontal" : orientation === "portrait" ? "&orientation=vertical" : "";
      const base = mediaType === "video" ? "https://pixabay.com/api/videos/" : "https://pixabay.com/api/";
      return { url: `${base}?key=${encodeURIComponent(key ?? "")}&q=${query}&per_page=20&safesearch=true${mediaType === "photo" ? `&image_type=photo${o}` : ""}` };
    }
    case "unsplash": {
      const o = orientation === "square" ? "&orientation=squarish" : orientation ? `&orientation=${orientation}` : "";
      return { url: `https://api.unsplash.com/search/photos?query=${query}&per_page=20&content_filter=high${o}`, headers: { Authorization: `Client-ID ${key ?? ""}`, "Accept-Version": "v1" } };
    }
    case "wikimedia": {
      const filter = mediaType === "video" ? "filetype:video" : "filetype:bitmap";
      const search = encodeURIComponent(`${q.slice(0, 100)} ${filter}`);
      return {
        url: `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=20&gsrsearch=${search}&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=480`,
      };
    }
    case "internet_archive": {
      const type = mediaType === "video" ? "movies" : "image";
      const search = encodeURIComponent(`(${q.slice(0, 100)}) AND mediatype:(${type})`);
      return { url: `https://archive.org/advancedsearch.php?q=${search}&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=licenseurl&fl%5B%5D=subject&rows=20&output=json` };
    }
  }
}

function map(provider: StockProviderId, body: unknown, mediaType: StockMediaType) {
  switch (provider) {
    case "pexels":
      return mapPexels(body, mediaType);
    case "pixabay":
      return mapPixabay(body, mediaType);
    case "unsplash":
      return mapUnsplash(body);
    case "wikimedia":
      return mapWikimedia(body, mediaType);
    case "internet_archive":
      return mapInternetArchive(body, mediaType);
  }
}

export interface StockSearchOutcome {
  results: StockResult[];
  errors: Array<{ provider: StockProviderId; message: string }>;
}

export async function searchStock(
  query: StockQuery,
  providers: StockProviderId[],
  keyFor: (id: StockProviderId) => Promise<string | null>,
): Promise<StockSearchOutcome> {
  const q = query.keywords.join(" ").trim();
  const errors: StockSearchOutcome["errors"] = [];
  const batches = await Promise.all(
    providers.map(async (provider) => {
      if (!STOCK_SUPPORTS[provider].includes(query.mediaType)) return [];
      const needsKey = provider === "pexels" || provider === "pixabay" || provider === "unsplash";
      const key = needsKey ? await keyFor(provider) : null;
      if (needsKey && !key) {
        errors.push({ provider, message: "No API key saved." });
        return [];
      }
      const cacheKey = `${provider}|${query.mediaType}|${query.orientation ?? ""}|${q.toLowerCase()}`;
      const hit = cache.get(cacheKey);
      if (hit && hit.expires > Date.now()) return hit.results;

      const { url, headers } = request(provider, q, query.mediaType, query.orientation ?? null, key);
      try {
        const res = await fetch(url, {
          headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...headers },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) {
          errors.push({ provider, message: res.status === 429 ? "Rate limit reached (429)." : res.status === 401 || res.status === 403 ? `Key rejected (${res.status}).` : `Search failed (${res.status}).` });
          return [];
        }
        const results = map(provider, await res.json().catch(() => null), query.mediaType);
        cache.set(cacheKey, { expires: Date.now() + STOCK_CACHE_TTL_MS[provider], results });
        if (cache.size > 500) cache.delete(cache.keys().next().value as string);
        return results;
      } catch {
        errors.push({ provider, message: "Could not reach the provider." });
        return [];
      }
    }),
  );
  return { results: rankResults(batches.flat(), query).slice(0, 60), errors };
}

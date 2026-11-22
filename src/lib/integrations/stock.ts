/**
 * Stock-media result normalisation and ranking (pure; no network).
 * Every result keeps provider, creator, source URL and licence so attribution survives.
 * Nothing here downloads media: results link to the provider's page and hotlink previews,
 * which is how Pexels, Pixabay and Unsplash ask API clients to display results.
 */

export type StockProviderId = "pexels" | "pixabay" | "unsplash" | "wikimedia" | "internet_archive";
export type StockMediaType = "photo" | "video";
export type StockOrientation = "landscape" | "portrait" | "square";

export interface StockResult {
  provider: StockProviderId;
  id: string;
  mediaType: StockMediaType;
  title: string;
  thumbnailUrl: string | null;
  sourceUrl: string;
  creator: string | null;
  creatorUrl: string | null;
  license: string;
  licenseUrl: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  tags: string[];
}

export interface StockQuery {
  keywords: string[];
  mediaType: StockMediaType;
  orientation?: StockOrientation | null;
  minDuration?: number | null;
  maxDuration?: number | null;
}

/** Provider-required cache lifetimes (Pixabay requires caching results for 24 hours). */
export const STOCK_CACHE_TTL_MS: Record<StockProviderId, number> = {
  pexels: 60 * 60 * 1000,
  pixabay: 24 * 60 * 60 * 1000,
  unsplash: 60 * 60 * 1000,
  wikimedia: 60 * 60 * 1000,
  internet_archive: 60 * 60 * 1000,
};

export const STOCK_SUPPORTS: Record<StockProviderId, StockMediaType[]> = {
  pexels: ["photo", "video"],
  pixabay: ["photo", "video"],
  unsplash: ["photo"],
  wikimedia: ["photo", "video"],
  internet_archive: ["photo", "video"],
};

const STOPWORDS = new Set(
  "a an and are as at be but by for from has have he her his i in into is it its of on or our she that the their them then there these they this to was we were what when where which who will with you your scene visual cue narrator voice over cut shot camera close up wide".split(" "),
);

/**
 * Scene-specific keywords: lowercase words, most frequent first. URLs, headings and the
 * "[Visual: …]" label are removed, but the visual cue's own words are kept.
 */
export function extractKeywords(text: string, max = 6): string[] {
  const counts = new Map<string, number>();
  const cleaned = text.toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/\[\s*visual\s*:|[[\]#]/g, " ");
  for (const word of cleaned.match(/[a-z][a-z'-]{2,}/g) ?? []) {
    const w = word.replace(/'s$/, "").replace(/^-+|-+$/g, "");
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([w]) => w);
}

export function orientationOf(width: number | null, height: number | null): StockOrientation | null {
  if (!width || !height) return null;
  const r = width / height;
  if (r > 1.1) return "landscape";
  if (r < 0.9) return "portrait";
  return "square";
}

function words(...values: Array<string | null | undefined>) {
  return values
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const httpsUrl = (v: unknown) => {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
};
const stripHtml = (v: unknown) => str(typeof v === "string" ? v.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ") : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// ---------------------------------------------------------------------------
// Provider mappers
// ---------------------------------------------------------------------------

export function mapPexels(body: unknown, mediaType: StockMediaType): StockResult[] {
  const b = (body ?? {}) as { photos?: unknown; videos?: unknown };
  const items = list(mediaType === "video" ? b.videos : b.photos);
  return items.flatMap((raw) => {
    const r = raw as Record<string, unknown>;
    const sourceUrl = httpsUrl(r.url);
    if (!sourceUrl || r.id === undefined) return [];
    const user = (r.user ?? {}) as Record<string, unknown>;
    const src = (r.src ?? {}) as Record<string, unknown>;
    return [{
      provider: "pexels" as const,
      id: String(r.id),
      mediaType,
      title: str(r.alt) ?? sourceUrl.split("/").filter(Boolean).pop()?.replace(/-\d+$/, "").replace(/-/g, " ") ?? "Pexels media",
      thumbnailUrl: mediaType === "video" ? httpsUrl(r.image) : httpsUrl(src.medium),
      sourceUrl,
      creator: mediaType === "video" ? str(user.name) : str(r.photographer),
      creatorUrl: mediaType === "video" ? httpsUrl(user.url) : httpsUrl(r.photographer_url),
      license: "Pexels License",
      licenseUrl: "https://www.pexels.com/license/",
      width: num(r.width),
      height: num(r.height),
      durationSec: mediaType === "video" ? num(r.duration) : null,
      tags: words(str(r.alt), sourceUrl),
    }];
  });
}

export function mapPixabay(body: unknown, mediaType: StockMediaType): StockResult[] {
  const items = list((body as { hits?: unknown } | null)?.hits);
  return items.flatMap((raw) => {
    const r = raw as Record<string, unknown>;
    const sourceUrl = httpsUrl(r.pageURL);
    if (!sourceUrl || r.id === undefined) return [];
    const videos = (r.videos ?? {}) as Record<string, Record<string, unknown> | undefined>;
    const tiny = videos.tiny ?? videos.small ?? {};
    const user = str(r.user);
    return [{
      provider: "pixabay" as const,
      id: String(r.id),
      mediaType,
      title: str(r.tags) ?? "Pixabay media",
      thumbnailUrl: mediaType === "video" ? httpsUrl(tiny.thumbnail) : httpsUrl(r.webformatURL) ?? httpsUrl(r.previewURL),
      sourceUrl,
      creator: user,
      creatorUrl: user && r.user_id !== undefined ? `https://pixabay.com/users/${encodeURIComponent(user)}-${encodeURIComponent(String(r.user_id))}/` : null,
      license: "Pixabay Content License",
      licenseUrl: "https://pixabay.com/service/license-summary/",
      width: mediaType === "video" ? num(tiny.width) : num(r.imageWidth),
      height: mediaType === "video" ? num(tiny.height) : num(r.imageHeight),
      durationSec: mediaType === "video" ? num(r.duration) : null,
      tags: words(str(r.tags)),
    }];
  });
}

/** Unsplash requires attribution links back to Unsplash with UTM parameters. */
export function unsplashLink(url: string) {
  const u = new URL(url);
  u.searchParams.set("utm_source", "storyflow_ai");
  u.searchParams.set("utm_medium", "referral");
  return u.toString();
}

export function mapUnsplash(body: unknown): StockResult[] {
  const items = list((body as { results?: unknown } | null)?.results);
  return items.flatMap((raw) => {
    const r = raw as Record<string, unknown>;
    const links = (r.links ?? {}) as Record<string, unknown>;
    const sourceUrl = httpsUrl(links.html);
    if (!sourceUrl || r.id === undefined) return [];
    const user = (r.user ?? {}) as Record<string, unknown>;
    const userLinks = (user.links ?? {}) as Record<string, unknown>;
    const creatorUrl = httpsUrl(userLinks.html);
    const urls = (r.urls ?? {}) as Record<string, unknown>;
    const description = str(r.description) ?? str(r.alt_description);
    return [{
      provider: "unsplash" as const,
      id: String(r.id),
      mediaType: "photo" as const,
      title: description ?? "Unsplash photo",
      thumbnailUrl: httpsUrl(urls.small),
      sourceUrl: unsplashLink(sourceUrl),
      creator: str(user.name),
      creatorUrl: creatorUrl ? unsplashLink(creatorUrl) : null,
      license: "Unsplash License",
      licenseUrl: "https://unsplash.com/license",
      width: num(r.width),
      height: num(r.height),
      durationSec: null,
      tags: words(description, ...list(r.tags).map((t) => str((t as { title?: unknown })?.title))),
    }];
  });
}

export function mapWikimedia(body: unknown, mediaType: StockMediaType): StockResult[] {
  const pages = ((body as { query?: { pages?: unknown } } | null)?.query?.pages ?? {}) as Record<string, unknown>;
  return Object.values(pages).flatMap((raw) => {
    const p = raw as Record<string, unknown>;
    const info = list(p.imageinfo)[0] as Record<string, unknown> | undefined;
    if (!info) return [];
    const mime = str(info.mime) ?? "";
    if (mediaType === "video" ? !mime.startsWith("video/") : !mime.startsWith("image/")) return [];
    const sourceUrl = httpsUrl(info.descriptionurl);
    if (!sourceUrl) return [];
    const meta = (info.extmetadata ?? {}) as Record<string, { value?: unknown } | undefined>;
    const title = (str(p.title) ?? "File").replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
    return [{
      provider: "wikimedia" as const,
      id: String(p.pageid ?? title),
      mediaType,
      title,
      thumbnailUrl: httpsUrl(info.thumburl),
      sourceUrl,
      creator: stripHtml(meta.Artist?.value),
      creatorUrl: null,
      license: str(meta.LicenseShortName?.value) ?? "See file page",
      licenseUrl: httpsUrl(meta.LicenseUrl?.value),
      width: num(info.width),
      height: num(info.height),
      durationSec: num(info.duration),
      tags: words(title, stripHtml(meta.ImageDescription?.value)),
    }];
  });
}

export function mapInternetArchive(body: unknown, mediaType: StockMediaType): StockResult[] {
  const docs = list((body as { response?: { docs?: unknown } } | null)?.response?.docs);
  return docs.flatMap((raw) => {
    const d = raw as Record<string, unknown>;
    const id = str(d.identifier);
    if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) return [];
    const creator = Array.isArray(d.creator) ? str(d.creator[0]) : str(d.creator);
    const subjects = Array.isArray(d.subject) ? d.subject.map(str) : [str(d.subject)];
    return [{
      provider: "internet_archive" as const,
      id,
      mediaType,
      title: str(d.title) ?? id,
      thumbnailUrl: `https://archive.org/services/img/${encodeURIComponent(id)}`,
      sourceUrl: `https://archive.org/details/${encodeURIComponent(id)}`,
      creator,
      creatorUrl: null,
      license: httpsUrl(d.licenseurl) ? "See licence link" : "Rights vary — check the item page",
      licenseUrl: httpsUrl(d.licenseurl),
      width: null,
      height: null,
      durationSec: null,
      tags: words(str(d.title), ...subjects),
    }];
  });
}

// ---------------------------------------------------------------------------
// Filtering and ranking
// ---------------------------------------------------------------------------

/** Relevance: keyword overlap first, then orientation and duration fit. Filters hard mismatches. */
export function rankResults(results: StockResult[], query: StockQuery): StockResult[] {
  const keywords = query.keywords.map((k) => k.toLowerCase());
  const scored = results.flatMap((r) => {
    if (r.mediaType !== query.mediaType) return [];
    const orientation = orientationOf(r.width, r.height);
    if (query.orientation && orientation && orientation !== query.orientation) return [];
    if (r.durationSec !== null) {
      if (query.minDuration && r.durationSec < query.minDuration) return [];
      if (query.maxDuration && r.durationSec > query.maxDuration) return [];
    }
    const tagSet = new Set(r.tags);
    const hits = keywords.filter((k) => tagSet.has(k) || r.title.toLowerCase().includes(k)).length;
    let score = keywords.length ? hits / keywords.length : 0;
    if (query.orientation && orientation === query.orientation) score += 0.2;
    if (r.thumbnailUrl) score += 0.05;
    if (r.licenseUrl) score += 0.05;
    return [{ r, score }];
  });
  return scored.sort((a, b) => b.score - a.score).map((s) => s.r);
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CATEGORIES, KEY_PROVIDER_IDS, LLM_PROVIDER_IDS, PROVIDERS } from "../src/lib/integrations/catalog.ts";
import {
  applyFreeModeToOrder,
  modelAvailability,
  normalizeModel,
  normalizeSettings,
  providerSelectability,
  resolveScenePlan,
  validateGenerationSettings,
  type GenerationSettings,
} from "../src/lib/integrations/plan.ts";
import { elevenLabsUsage, modelIdsFromList, usageFromHeaders } from "../src/lib/integrations/limits.ts";
import {
  extractKeywords,
  mapInternetArchive,
  mapPexels,
  mapPixabay,
  mapUnsplash,
  mapWikimedia,
  rankResults,
  STOCK_CACHE_TTL_MS,
} from "../src/lib/integrations/stock.ts";
import {
  AiPlanError,
  buildLlmRequest,
  classifyStatus,
  describeProviderError,
  normalizeModelId,
  parseLlmText,
  planScenesWithFallback,
  ProviderCallError,
  providerErrorDetail,
  resolveJobAiPlan,
} from "../worker/llm-providers.mjs";

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

test("catalog: unique ids, valid categories, https docs, approval notes where required", () => {
  const ids = PROVIDERS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  const categories = new Set(CATEGORIES.map((c) => c.id));
  for (const p of PROVIDERS) {
    assert.ok(categories.has(p.category), p.id);
    assert.match(p.docsUrl, /^https:\/\//, p.id);
    if (p.status === "requires_approval") assert.ok(p.approval, `${p.id} must explain the approval it needs`);
    if (p.llm) assert.match(p.llm.baseUrl, /^https:\/\//, p.id);
    if (p.auth === "oauth" && p.category === "publishing") assert.ok(p.scopes && p.scopes.length > 0, `${p.id} lists its minimum scopes`);
  }
  for (const id of ["youtube", "tiktok", "pinterest", "canva"]) assert.equal(PROVIDERS.find((p) => p.id === id)?.status, "requires_approval");
  for (const id of ["capcut", "mixkit"]) assert.equal(PROVIDERS.find((p) => p.id === id)?.status, "manual");
});

test("catalog matches the database constraints in the integrations migration", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261124000000_integrations_hub.sql", import.meta.url), "utf8");
  const block = (name: string) => {
    const start = sql.indexOf(`constraint ${name}`);
    return [...sql.slice(start, sql.indexOf("));", start)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  };
  assert.deepEqual(block("workspace_provider_credentials_provider_check"), [...KEY_PROVIDER_IDS].sort());
  assert.deepEqual(block("workspace_integrations_provider_check"), [...PROVIDERS.map((p) => p.id), "webhook"].sort());
  const llmCheck = sql.slice(sql.indexOf("ai_providers <@ array["), sql.indexOf("]::text[]", sql.indexOf("ai_providers <@ array[")));
  assert.deepEqual([...llmCheck.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort(), [...LLM_PROVIDER_IDS].sort());
});

// ---------------------------------------------------------------------------
// Plan resolution (Free Mode, paid providers, fallback)
// ---------------------------------------------------------------------------

const settings = (over: Partial<GenerationSettings> = {}): GenerationSettings => ({
  freeMode: false,
  aiProviders: ["groq", "anthropic", "openai"],
  aiModels: { groq: "llama-x", openai: "gpt-x" },
  ...over,
});

test("plan: configured order, only providers with keys, models required except Claude", () => {
  const plan = resolveScenePlan({ settings: settings(), keys: new Set(["groq", "anthropic"]), disabled: new Set() });
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.deepEqual(plan.providers.map((p) => p.id), ["groq", "anthropic"]);
    assert.equal(plan.usesPaid, true);
    assert.match(plan.excluded[0].reason, /No OpenAI API key/);
  }
  const noModel = resolveScenePlan({ settings: settings({ aiModels: {} }), keys: new Set(["groq"]), disabled: new Set() });
  assert.equal(noModel.ok, false);
});

test("plan: Free Mode removes paid providers and never falls back to them", () => {
  const plan = resolveScenePlan({ settings: settings({ freeMode: true }), keys: new Set(["groq", "anthropic", "openai"]), disabled: new Set() });
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.deepEqual(plan.providers.map((p) => p.id), ["groq"]);
    assert.equal(plan.usesPaid, false);
  }
  const paidPrimary = resolveScenePlan({ settings: settings({ freeMode: true }), primary: "anthropic", keys: new Set(["anthropic", "groq"]), disabled: new Set() });
  assert.equal(paidPrimary.ok, false);
  if (!paidPrimary.ok) assert.match(paidPrimary.error, /paid provider and Free Mode is on/);
  const nothingFree = resolveScenePlan({ settings: settings({ freeMode: true }), keys: new Set(["anthropic"]), disabled: new Set() });
  assert.equal(nothingFree.ok, false);
  if (!nothingFree.ok) assert.match(nothingFree.error, /No free-tier AI provider/);
});

test("plan: disabled providers and unconfigured primaries are rejected", () => {
  const disabled = resolveScenePlan({ settings: settings(), primary: "groq", keys: new Set(["groq"]), disabled: new Set(["groq"]) });
  assert.equal(disabled.ok, false);
  const unconfigured = resolveScenePlan({ settings: settings(), primary: "mistral", keys: new Set(["mistral"]), disabled: new Set() });
  assert.equal(unconfigured.ok, false);
  const primary = resolveScenePlan({ settings: settings(), primary: "anthropic", keys: new Set(["groq", "anthropic"]), disabled: new Set() });
  assert.ok(primary.ok && primary.providers[0].id === "anthropic" && primary.providers[1].id === "groq");
});

test("settings normalisation drops unknown providers and bad models; only a missing row defaults to Claude", () => {
  assert.deepEqual(normalizeSettings(null), { freeMode: false, aiProviders: ["anthropic"], aiModels: {}, isDefault: true });
  assert.deepEqual(
    normalizeSettings({ free_mode: true, ai_providers: ["groq", "evil", 3], ai_models: { groq: "ok-model", openai: "bad model!", x: "y" } }),
    { freeMode: true, aiProviders: ["groq"], aiModels: { groq: "ok-model" }, isDefault: false },
  );
});

test("regression: a saved free provider is never replaced by Claude", () => {
  // Saved row whose providers are all invalid → empty list (clear error), not Claude.
  const broken = normalizeSettings({ free_mode: false, ai_providers: ["removed_provider"], ai_models: {} });
  assert.deepEqual(broken.aiProviders, []);
  const plan = resolveScenePlan({ settings: broken, keys: new Set(["anthropic"]), disabled: new Set() });
  assert.equal(plan.ok, false);
  // Saved Groq primary → studio and generation use Groq, with no Claude anywhere in the chain.
  const saved = normalizeSettings({ free_mode: true, ai_providers: ["groq"], ai_models: { groq: "llama" } });
  const groq = resolveScenePlan({ settings: saved, primary: "groq", keys: new Set(["groq", "anthropic"]), disabled: new Set() });
  assert.ok(groq.ok);
  if (groq.ok) assert.deepEqual(groq.providers.map((p) => p.id), ["groq"]);
  const noPrimary = resolveScenePlan({ settings: saved, keys: new Set(["groq", "anthropic"]), disabled: new Set() });
  assert.ok(noPrimary.ok && noPrimary.providers.every((p) => p.id !== "anthropic"));
});

test("regression: saving validates enabled, connected, Free Mode and models server-side", () => {
  const base = { freeMode: false, keys: new Set(["groq", "gemini", "anthropic"]), disabled: new Set<string>() };
  const ok = validateGenerationSettings({ ...base, providers: ["groq", "", "gemini", "groq"], models: { groq: " llama ", gemini: "g-1" } });
  assert.deepEqual(ok, { ok: true, providers: ["groq", "gemini"], models: { groq: "llama", gemini: "g-1" } });
  // Primary left empty but a fallback chosen still saves (no false "choose at least one").
  assert.equal(validateGenerationSettings({ ...base, providers: ["", "groq"], models: { groq: "m" } }).ok, true);
  const cases: Array<[Parameters<typeof validateGenerationSettings>[0], RegExp]> = [
    [{ ...base, providers: ["", "", ""], models: {} }, /at least one/],
    [{ ...base, providers: ["evil"], models: {} }, /valid AI providers/],
    [{ ...base, providers: ["mistral"], models: { mistral: "m" } }, /not connected/],
    [{ ...base, disabled: new Set(["groq"]), providers: ["groq"], models: { groq: "m" } }, /disabled for this workspace/],
    [{ ...base, freeMode: true, providers: ["groq", "anthropic"], models: { groq: "m" } }, /paid provider and cannot be used in Free Mode \(including as a fallback\)/],
    [{ ...base, providers: ["groq"], models: {} }, /Choose a Groq model/],
    [{ ...base, providers: ["groq"], models: { groq: "bad model" } }, /Model ids/],
  ];
  for (const [input, re] of cases) {
    const r = validateGenerationSettings(input);
    assert.equal(r.ok, false, JSON.stringify(input.providers));
    if (!r.ok) assert.match(r.error, re);
  }
  assert.equal(validateGenerationSettings({ ...base, providers: ["anthropic"], models: {} }).ok, true, "Claude model is optional");
});

test("regression: settings form selectability and Free Mode pruning", () => {
  const ctx = { freeMode: true, keys: new Set(["groq", "anthropic"]), disabled: new Set(["gemini"]) };
  assert.deepEqual(providerSelectability("groq", ctx), { selectable: true, reason: null });
  assert.equal(providerSelectability("anthropic", ctx).selectable, false);
  assert.match(providerSelectability("anthropic", ctx).reason ?? "", /Free Mode/);
  assert.match(providerSelectability("gemini", ctx).reason ?? "", /disabled/);
  assert.match(providerSelectability("mistral", ctx).reason ?? "", /not connected/);
  assert.equal(providerSelectability("anthropic", { ...ctx, freeMode: false }).selectable, true);
  assert.deepEqual(applyFreeModeToOrder(["anthropic", "groq", "openai", "gemini"]), { order: ["groq", "gemini", "", ""], removed: ["anthropic", "openai"] });
  assert.deepEqual(applyFreeModeToOrder(["groq", "", "", ""]), { order: ["groq", "", "", ""], removed: [] });
});

// ---------------------------------------------------------------------------
// Usage limits and model lists
// ---------------------------------------------------------------------------

test("usage limits come from provider rate-limit headers", () => {
  const headers = new Headers({
    "x-ratelimit-limit-requests": "14400",
    "x-ratelimit-remaining-requests": "14399",
    "x-ratelimit-remaining-tokens": "5999",
    "content-type": "application/json",
  });
  assert.deepEqual(usageFromHeaders(headers), [
    { label: "Request limit", value: "14400" },
    { label: "Requests remaining", value: "14399" },
    { label: "Tokens remaining", value: "5999" },
  ]);
  assert.deepEqual(new Set(usageFromHeaders(new Headers({ "X-Ratelimit-Limit": "200", "X-Ratelimit-Remaining": "198" })).map((l) => l.label)), new Set(["Request limit", "Requests remaining"]));
  assert.deepEqual(elevenLabsUsage({ tier: "free", character_count: 1200, character_limit: 10000 }), [
    { label: "Plan", value: "free" },
    { label: "Characters used", value: "1,200 / 10,000" },
  ]);
});

test("model lists parse OpenAI-style, Together arrays and Gemini (text models only)", () => {
  assert.deepEqual(modelIdsFromList({ data: [{ id: "b" }, { id: "a" }, { id: "bad id" }] }), ["a", "b"]);
  assert.deepEqual(modelIdsFromList([{ id: "together/x" }]), ["together/x"]);
  assert.deepEqual(
    modelIdsFromList({ models: [{ name: "models/gemini-x", supportedGenerationMethods: ["generateContent"] }, { name: "models/embed", supportedGenerationMethods: ["embedContent"] }] }),
    ["gemini-x"],
  );
});

// ---------------------------------------------------------------------------
// Stock media
// ---------------------------------------------------------------------------

test("scene keywords skip stopwords and markup", () => {
  assert.deepEqual(extractKeywords("## Scene 1\n[Visual: drone shot] The lighthouse stands above the stormy sea. The lighthouse glows."), [
    "lighthouse",
    "above",
    "drone",
    "glows",
    "sea",
    "stands",
  ]);
});

test("stock mappers keep provider, creator, source and licence", () => {
  const pexels = mapPexels({ photos: [{ id: 1, width: 1920, height: 1080, url: "https://www.pexels.com/photo/lighthouse-at-dawn-1/", photographer: "Ana", photographer_url: "https://www.pexels.com/@ana", alt: "Lighthouse at dawn", src: { medium: "https://images.pexels.com/1.jpg" } }] }, "photo");
  assert.deepEqual(
    { provider: pexels[0].provider, creator: pexels[0].creator, license: pexels[0].license, sourceUrl: pexels[0].sourceUrl },
    { provider: "pexels", creator: "Ana", license: "Pexels License", sourceUrl: "https://www.pexels.com/photo/lighthouse-at-dawn-1/" },
  );
  const pixabay = mapPixabay({ hits: [{ id: 7, pageURL: "https://pixabay.com/videos/sea-7/", tags: "sea, waves", duration: 12, user: "bob", user_id: 3, videos: { tiny: { url: "https://cdn.pixabay.com/v.mp4", width: 640, height: 360, thumbnail: "https://cdn.pixabay.com/t.jpg" } } }] }, "video");
  assert.equal(pixabay[0].durationSec, 12);
  assert.equal(pixabay[0].creatorUrl, "https://pixabay.com/users/bob-3/");
  const unsplash = mapUnsplash({ results: [{ id: "u1", width: 800, height: 1200, alt_description: "sea cliff", urls: { small: "https://images.unsplash.com/s" }, links: { html: "https://unsplash.com/photos/u1" }, user: { name: "Cy", links: { html: "https://unsplash.com/@cy" } } }] });
  assert.match(unsplash[0].sourceUrl, /utm_source=storyflow_ai&utm_medium=referral/);
  assert.match(unsplash[0].creatorUrl ?? "", /utm_source=storyflow_ai/);
  const wiki = mapWikimedia({ query: { pages: { "9": { pageid: 9, title: "File:Lighthouse.jpg", imageinfo: [{ mime: "image/jpeg", descriptionurl: "https://commons.wikimedia.org/wiki/File:Lighthouse.jpg", thumburl: "https://upload.wikimedia.org/t.jpg", width: 1000, height: 700, extmetadata: { Artist: { value: "<a href='x'>Dee</a>" }, LicenseShortName: { value: "CC BY-SA 4.0" }, LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" } } }] } } } }, "photo");
  assert.deepEqual([wiki[0].creator, wiki[0].license], ["Dee", "CC BY-SA 4.0"]);
  const ia = mapInternetArchive({ response: { docs: [{ identifier: "old_film_1", title: "Old film", creator: ["Studio"], subject: ["sea"] }, { identifier: "../bad" }] } }, "video");
  assert.equal(ia.length, 1);
  assert.equal(ia[0].license, "Rights vary — check the item page");
  assert.equal(mapPexels({ photos: [{ id: 2, url: "javascript:alert(1)" }] }, "photo").length, 0);
});

test("stock ranking filters orientation and duration, then ranks by keyword relevance", () => {
  const base = { mediaType: "video" as const, thumbnailUrl: null, creator: null, creatorUrl: null, license: "x", licenseUrl: null, sourceUrl: "https://x" };
  const results = [
    { ...base, provider: "pexels" as const, id: "1", title: "city night", tags: ["city", "night"], width: 1920, height: 1080, durationSec: 10 },
    { ...base, provider: "pexels" as const, id: "2", title: "stormy sea lighthouse", tags: ["sea", "lighthouse"], width: 1920, height: 1080, durationSec: 12 },
    { ...base, provider: "pexels" as const, id: "3", title: "lighthouse portrait", tags: ["lighthouse"], width: 1080, height: 1920, durationSec: 12 },
    { ...base, provider: "pexels" as const, id: "4", title: "lighthouse long", tags: ["lighthouse"], width: 1920, height: 1080, durationSec: 300 },
  ];
  const ranked = rankResults(results, { keywords: ["lighthouse", "sea"], mediaType: "video", orientation: "landscape", maxDuration: 60 });
  assert.deepEqual(ranked.map((r) => r.id), ["2", "1"]);
  assert.equal(STOCK_CACHE_TTL_MS.pixabay, 24 * 60 * 60 * 1000);
});

// ---------------------------------------------------------------------------
// Worker LLM adapters and fallback
// ---------------------------------------------------------------------------

test("worker plan: older jobs keep Claude; Free Mode and paid confirmation are enforced", () => {
  assert.deepEqual(resolveJobAiPlan({ title: "x" }), { legacy: true, freeMode: false, providers: [{ id: "anthropic", model: null, paid: true }] });
  assert.throws(() => resolveJobAiPlan({ ai: { providers: [{ id: "anthropic", model: null }], freeMode: true, paidAcknowledged: true } }), AiPlanError);
  assert.throws(() => resolveJobAiPlan({ ai: { providers: [{ id: "openai", model: "m" }], freeMode: false, paidAcknowledged: false } }), /not confirmed/);
  assert.throws(() => resolveJobAiPlan({ ai: { providers: [{ id: "groq", model: null }], freeMode: true } }), /No Groq model/);
  assert.throws(() => resolveJobAiPlan({ ai: { providers: [{ id: "evil", model: "m" }] } }), AiPlanError);
  assert.throws(() => resolveJobAiPlan({ ai: { providers: [{ id: "groq", model: "bad model" }] } }), AiPlanError);
  const ok = resolveJobAiPlan({ ai: { providers: [{ id: "groq", model: "m1" }, { id: "gemini", model: "g1" }], freeMode: true } });
  assert.deepEqual(ok.providers.map((p: { id: string }) => p.id), ["groq", "gemini"]);
});

test("worker builds provider-specific requests and parses their responses", () => {
  const claude = buildLlmRequest("anthropic", null, "k", "sys", "user", "default-claude");
  assert.equal(claude.url, "https://api.anthropic.com/v1/messages");
  assert.equal(JSON.parse(claude.init.body).model, "default-claude");
  const groq = buildLlmRequest("groq", "m", "k", "sys", "user", "x");
  assert.equal(groq.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(groq.init.headers.Authorization, "Bearer k");
  const gemini = buildLlmRequest("gemini", "g-1", "k", "sys", "user", "x");
  assert.equal(gemini.url, "https://generativelanguage.googleapis.com/v1beta/models/g-1:generateContent");
  assert.equal(gemini.init.headers["x-goog-api-key"], "k");
  assert.equal(parseLlmText("anthropic", { content: [{ type: "text", text: "A" }, { type: "tool_use" }] }), "A");
  assert.equal(parseLlmText("groq", { choices: [{ message: { content: "B" } }] }), "B");
  assert.equal(parseLlmText("gemini", { candidates: [{ content: { parts: [{ text: "C" }, { text: "D" }] } }] }), "CD");
  assert.equal(classifyStatus(429), "quota");
  assert.equal(classifyStatus(402), "quota");
  assert.equal(classifyStatus(401), "auth");
});

function fakeFetch(responses: Record<string, { status: number; body: unknown }>, calls: string[]) {
  return async (url: string) => {
    calls.push(url);
    const host = new URL(url).host;
    const r = responses[host] ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  };
}

test("fallback goes only to the next configured provider after quota errors", async () => {
  const calls: string[] = [];
  const plan = resolveJobAiPlan({ ai: { providers: [{ id: "groq", model: "m" }, { id: "gemini", model: "g" }], freeMode: true } });
  const result = await planScenesWithFallback({
    plan,
    system: "s",
    user: "u",
    getKey: async () => "key",
    isDisabled: () => false,
    defaultClaudeModel: "c",
    fetchImpl: fakeFetch(
      {
        "api.groq.com": { status: 429, body: { error: { message: "rate limited" } } },
        "generativelanguage.googleapis.com": { status: 200, body: { candidates: [{ content: { parts: [{ text: "planned" }] } }] } },
      },
      calls,
    ) as unknown as typeof fetch,
  });
  assert.deepEqual(result, { text: "planned", provider: "gemini", model: "g" });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((u) => new URL(u).host), ["api.groq.com", "generativelanguage.googleapis.com"], "never calls providers outside the plan");
});

test("Free Mode stops with a clear quota message instead of using a paid provider", async () => {
  const calls: string[] = [];
  const plan = resolveJobAiPlan({ ai: { providers: [{ id: "groq", model: "m" }], freeMode: true } });
  await assert.rejects(
    planScenesWithFallback({
      plan,
      system: "s",
      user: "u",
      getKey: async (id: string) => (id === "groq" ? "key" : "paid-key-not-in-plan"),
      isDisabled: () => false,
      defaultClaudeModel: "c",
      fetchImpl: fakeFetch({ "api.groq.com": { status: 429, body: {} } }, calls) as unknown as typeof fetch,
    }),
    /Free Mode never falls back to paid providers.*Groq \(model m\): quota or credits exhausted \(429\)/,
  );
  assert.equal(calls.length, 1);
});

test("missing keys and workspace-disabled providers are skipped, not substituted", async () => {
  const calls: string[] = [];
  const plan = resolveJobAiPlan({ ai: { providers: [{ id: "groq", model: "m" }, { id: "mistral", model: "x" }, { id: "gemini", model: "g" }], freeMode: true } });
  await assert.rejects(
    planScenesWithFallback({
      plan,
      system: "s",
      user: "u",
      getKey: async (id: string) => (id === "gemini" ? "key" : null),
      isDisabled: (id: string) => id === "gemini",
      defaultClaudeModel: "c",
      fetchImpl: fakeFetch({}, calls) as unknown as typeof fetch,
    }),
    /Groq: no API key saved; Mistral AI: no API key saved; Google Gemini: disabled for this workspace/,
  );
  assert.equal(calls.length, 0);
});

test("older jobs call Claude only, exactly as before", async () => {
  const calls: string[] = [];
  const result = await planScenesWithFallback({
    plan: resolveJobAiPlan({}),
    system: "s",
    user: "u",
    getKey: async (id: string) => (id === "anthropic" ? "key" : null),
    isDisabled: () => true,
    defaultClaudeModel: "claude-default",
    fetchImpl: fakeFetch({ "api.anthropic.com": { status: 200, body: { content: [{ type: "text", text: "scenes" }] } } }, calls) as unknown as typeof fetch,
  });
  assert.deepEqual(result, { text: "scenes", provider: "anthropic", model: "claude-default" });
  assert.deepEqual(calls, ["https://api.anthropic.com/v1/messages"]);
});

// ---------------------------------------------------------------------------
// Regression: Gemini 404 (model not available for the key)
// ---------------------------------------------------------------------------

const GEMINI_404 = {
  error: {
    code: 404,
    message: "models/gemini-2.5-pro is not found for API version v1beta, or is not supported for generateContent. key=AIzaSyFAKEFAKEFAKEFAKEFAKE",
    status: "NOT_FOUND",
  },
};

test("Gemini model ids are normalised and sent to /models/<id>:generateContent", () => {
  assert.equal(normalizeModelId("gemini", "models/gemini-x"), "gemini-x");
  assert.equal(normalizeModelId("groq", "models/keep-me"), "models/keep-me");
  const req = buildLlmRequest("gemini", "models/gemini-x", "k", "s", "u", "c");
  assert.equal(req.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent");
  const small = buildLlmRequest("gemini", "gemini-x", "k", "s", "u", "c", 16);
  assert.equal(JSON.parse(small.init.body).generationConfig.maxOutputTokens, 16);
  assert.equal(normalizeModel("gemini", " models/gemini-x "), "gemini-x");
});

test("404 is reported as model unavailable with the model id and the provider's own message (key redacted)", () => {
  assert.equal(classifyStatus(404), "model_unavailable");
  const detail = providerErrorDetail(GEMINI_404);
  assert.match(detail ?? "", /models\/gemini-2\.5-pro is not found for API version v1beta/);
  assert.doesNotMatch(detail ?? "", /AIza/);
  const message = describeProviderError(new ProviderCallError("gemini", "model_unavailable", "request failed (404)", 404, "gemini-2.5-pro", detail));
  assert.match(message, /^Google Gemini \(model gemini-2\.5-pro\): model not found or not available for this API key \(404\) — models\/gemini-2\.5-pro is not found/);
  assert.equal(providerErrorDetail({ error: { message: "Bearer abc.def and sk-ant-REALLOOKINGKEY123 and ?key=secret" } }), "Bearer [redacted] and [redacted] and ?key=[redacted]");
  assert.equal(providerErrorDetail(null), null);
});

test("Free Mode: after a Gemini 404 only other configured free providers are tried — never Claude", async () => {
  const calls: string[] = [];
  const plan = resolveJobAiPlan({ ai: { providers: [{ id: "gemini", model: "gemini-2.5-pro" }, { id: "groq", model: "llama" }], freeMode: true } });
  const result = await planScenesWithFallback({
    plan,
    system: "s",
    user: "u",
    getKey: async () => "key",
    isDisabled: () => false,
    defaultClaudeModel: "claude",
    fetchImpl: fakeFetch(
      {
        "generativelanguage.googleapis.com": { status: 404, body: GEMINI_404 },
        "api.groq.com": { status: 200, body: { choices: [{ message: { content: "groq plan" } }] } },
        "api.anthropic.com": { status: 200, body: { content: [{ type: "text", text: "must not be used" }] } },
      },
      calls,
    ) as unknown as typeof fetch,
  });
  assert.deepEqual(result, { text: "groq plan", provider: "groq", model: "llama" });
  assert.deepEqual(calls.map((u) => new URL(u).host), ["generativelanguage.googleapis.com", "api.groq.com"]);
});

test("when Gemini is the only free provider, generation stops with the exact model and provider error", async () => {
  const calls: string[] = [];
  const plan = resolveJobAiPlan({ ai: { providers: [{ id: "gemini", model: "models/gemini-2.5-pro" }], freeMode: true } });
  await assert.rejects(
    planScenesWithFallback({
      plan,
      system: "s",
      user: "u",
      getKey: async () => "key",
      isDisabled: () => false,
      defaultClaudeModel: "claude",
      fetchImpl: fakeFetch({ "generativelanguage.googleapis.com": { status: 404, body: GEMINI_404 } }, calls) as unknown as typeof fetch,
    }),
    (err: Error) => {
      assert.match(err.message, /Free Mode never falls back to paid providers/);
      assert.match(err.message, /Google Gemini \(model gemini-2\.5-pro\): model not found or not available for this API key \(404\) — models\/gemini-2\.5-pro is not found for API version v1beta/);
      assert.doesNotMatch(err.message, /AIza/);
      return true;
    },
  );
  assert.deepEqual(calls, ["https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent"]);
});

test("saved models are checked against the live model list (no hard-coded names)", () => {
  const live = ["gemini-a", "models/gemini-b"];
  assert.deepEqual(modelAvailability("gemini", "gemini-a", live), { ok: true, model: "gemini-a", message: null });
  assert.equal(modelAvailability("gemini", "models/gemini-b", live).ok, true);
  const missing = modelAvailability("gemini", "gemini-2.5-pro", live);
  assert.equal(missing.ok, false);
  assert.match(missing.message ?? "", /Google Gemini model "gemini-2\.5-pro" is not available for your API key/);
  assert.equal(modelAvailability("groq", "llama", []).ok, false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeScript, recommendProduction, type ProviderCandidate } from "../src/lib/production/director.ts";

const story = `## Scene 1
Maya walks into the old lighthouse. She lights a lantern.
## Scene 2
The storm grows. Maya climbs the stairs and her lantern flickers.
## Scene 3
At the top, Maya sees the ship and signals it home.`;

const p = (over: Partial<ProviderCandidate>): ProviderCandidate => ({
  id: "groq",
  name: "Groq",
  pricing: "free_tier",
  available: true,
  validated: true,
  reason: null,
  model: "m",
  ...over,
});

test("script analysis: scenes, duration, writing system and recurring character", () => {
  const a = analyzeScript(story);
  assert.equal(a.scenes, 3);
  assert.equal(a.writingSystem, "latin");
  assert.equal(a.recurringCharacter, true);
  assert.equal(a.characterHint, "Maya");
  assert.ok(a.estimatedSeconds > 0);
  const explainer = analyzeScript("Interest rates affect mortgages. Lower rates reduce monthly payments. Inflation changes the picture.");
  assert.equal(explainer.recurringCharacter, false);
  assert.equal(analyzeScript("مرحبا بكم في القصة الجديدة اليوم").writingSystem, "arabic");
});

test("director recommends only verified providers, cheapest pricing first, never paid in Free Mode", () => {
  const analysis = analyzeScript(story);
  const candidates = [
    p({ id: "anthropic", name: "Anthropic Claude", pricing: "paid", model: null }),
    p({ id: "gemini", name: "Google Gemini", validated: false, reason: "model not available" }),
    p({ id: "groq", name: "Groq" }),
  ];
  const free = recommendProduction({ analysis, scenePlanners: candidates, geminiValidated: true, freeMode: true });
  assert.equal(free.scenePlanning.value, "groq");
  const paidOnly = recommendProduction({ analysis, scenePlanners: [candidates[0]], geminiValidated: true, freeMode: true });
  assert.equal(paidOnly.scenePlanning.value, null);
  assert.match(paidOnly.scenePlanning.reason, /No connected and verified/);
  const notFree = recommendProduction({ analysis, scenePlanners: [candidates[0]], geminiValidated: true, freeMode: false });
  assert.equal(notFree.scenePlanning.value, "anthropic");
  assert.match(notFree.scenePlanning.reason, /paid provider/);
  const unverified = recommendProduction({ analysis, scenePlanners: [candidates[1]], geminiValidated: true, freeMode: false });
  assert.equal(unverified.scenePlanning.value, null);
});

test("character reference: recommended for a recurring character, skipped otherwise or when Gemini is unverified", () => {
  const scenePlanners = [p({})];
  assert.equal(recommendProduction({ analysis: analyzeScript(story), scenePlanners, geminiValidated: true, freeMode: true }).characterReference.value, true);
  assert.equal(
    recommendProduction({ analysis: analyzeScript("Rates rise. Payments change. Budgets adjust over time."), scenePlanners, geminiValidated: true, freeMode: true }).characterReference.value,
    false,
  );
  const noGemini = recommendProduction({ analysis: analyzeScript(story), scenePlanners, geminiValidated: false, freeMode: true });
  assert.equal(noGemini.characterReference.value, false);
  assert.match(noGemini.characterReference.reason, /unavailable/);
});

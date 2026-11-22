/**
 * AI Production Director: analyses a script and recommends a provider for each production
 * task. Pure and deterministic (no network, no model calls) so recommendations are explainable
 * and testable. Only providers that the caller marks as validated can be recommended.
 */

export interface ScriptAnalysis {
  words: number;
  characters: number;
  scenes: number;
  estimatedSeconds: number;
  /** Dominant writing system, used to suggest a matching narration voice language. */
  writingSystem: "latin" | "arabic" | "devanagari" | "cjk" | "cyrillic" | "other";
  /** Heuristic: the script follows a recurring on-screen character. */
  recurringCharacter: boolean;
  characterHint: string | null;
}

const WPM = 150;
const PRONOUNS = /\b(he|she|him|her|his|hers|they|them|their)\b/gi;

export function analyzeScript(content: string): ScriptAnalysis {
  const text = content.trim();
  const words = text ? text.split(/\s+/).length : 0;
  const sceneMarkers = text.match(/^\s*(#{1,3}\s+\S.*|scene\b.*|(int|ext)\.\s.*)$/gim)?.length ?? 0;
  const visualCues = text.match(/\[\s*visual\s*:/gi)?.length ?? 0;

  const letters = text.replace(/[^\p{L}]/gu, "");
  const count = (re: RegExp) => (letters.match(re) ?? []).length;
  const systems: Array<[ScriptAnalysis["writingSystem"], number]> = [
    ["latin", count(/\p{Script=Latin}/gu)],
    ["arabic", count(/\p{Script=Arabic}/gu)],
    ["devanagari", count(/\p{Script=Devanagari}/gu)],
    ["cjk", count(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)],
    ["cyrillic", count(/\p{Script=Cyrillic}/gu)],
  ];
  const [top, topCount] = systems.sort((a, b) => b[1] - a[1])[0];
  const writingSystem = topCount === 0 ? "other" : top;

  // Recurring character: a capitalised name repeated 3+ times, or many third-person pronouns.
  // Heading lines are ignored, and so are words that also appear in lowercase (ordinary words
  // that merely start a sentence, e.g. "The", "Interest").
  const body = text
    .split("\n")
    .filter((line) => !/^\s*(#{1,3}\s|scene\b|(int|ext)\.\s)/i.test(line))
    .join("\n");
  const lowercaseWords = new Set(body.match(/\b[a-z][a-z]{2,}\b/g) ?? []);
  const names = new Map<string, number>();
  for (const m of body.matchAll(/\b([A-Z][a-z]{2,})\b/g)) {
    if (lowercaseWords.has(m[1].toLowerCase())) continue;
    names.set(m[1], (names.get(m[1]) ?? 0) + 1);
  }
  const [name, nameCount] = [...names.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const pronouns = text.match(PRONOUNS)?.length ?? 0;
  const recurringCharacter = nameCount >= 3 || pronouns >= 4;

  return {
    words,
    characters: content.length,
    scenes: Math.max(sceneMarkers, visualCues, words ? 1 : 0),
    estimatedSeconds: Math.round((words / WPM) * 60),
    writingSystem,
    recurringCharacter,
    characterHint: nameCount >= 3 ? name : null,
  };
}

export interface ProviderCandidate {
  id: string;
  name: string;
  pricing: "free" | "free_tier" | "paid";
  /** Connected, enabled and allowed by Free Mode (from resolveScenePlan). */
  available: boolean;
  /** Integration Validation: key works now and the chosen model is in the live model list. */
  validated: boolean;
  reason: string | null;
  model: string | null;
}

export interface TaskRecommendation<T> {
  value: T;
  reason: string;
}

export interface ProductionRecommendation {
  scenePlanning: TaskRecommendation<string | null>;
  characterReference: TaskRecommendation<boolean>;
  narration: string;
}

const PRICING_RANK = { free: 0, free_tier: 1, paid: 2 } as const;

export function recommendProduction(input: {
  analysis: ScriptAnalysis;
  scenePlanners: ProviderCandidate[];
  geminiValidated: boolean;
  freeMode: boolean;
}): ProductionRecommendation {
  const { analysis } = input;
  // Only validated providers, preferring the cheapest pricing class, then the workspace's order.
  const ranked = input.scenePlanners
    .map((p, order) => ({ p, order }))
    .filter(({ p }) => p.available && p.validated && !(input.freeMode && p.pricing === "paid"))
    .sort((a, b) => PRICING_RANK[a.p.pricing] - PRICING_RANK[b.p.pricing] || a.order - b.order);
  const best = ranked[0]?.p ?? null;
  const scenePlanning: TaskRecommendation<string | null> = best
    ? {
        value: best.id,
        reason: `${best.name}${best.model ? ` (${best.model})` : ""} is connected and verified${
          best.pricing === "paid" ? "; it is a paid provider" : ", and has a free tier"
        }. ${analysis.scenes > 6 || analysis.words > 600 ? "Longer scripts benefit from a capable model; " : ""}It ${
          ranked.length > 1 ? "is first in your workspace order among the lowest-cost options." : "is the only verified option."
        }`,
      }
    : { value: null, reason: "No connected and verified AI provider is available for scene planning. Add or fix one in Integrations." };

  const characterReference: TaskRecommendation<boolean> = !input.geminiValidated
    ? { value: false, reason: "Gemini is not connected or could not be verified, so the character reference step is unavailable." }
    : analysis.recurringCharacter
      ? {
          value: true,
          reason: `The script follows a recurring character${analysis.characterHint ? ` (${analysis.characterHint})` : ""}; a reference image keeps them consistent.`,
        }
      : { value: false, reason: "No recurring on-screen character detected; skipping the reference saves Gemini quota." };

  const narration =
    analysis.writingSystem === "latin" || analysis.writingSystem === "other"
      ? "Engine voices (Edge-TTS). Pick a voice in the Voice step, or keep the engine default."
      : `Engine voices (Edge-TTS). The script looks ${analysis.writingSystem === "cjk" ? "Chinese/Japanese/Korean" : analysis.writingSystem} — choose a voice in that language in the Voice step.`;

  return { scenePlanning, characterReference, narration };
}

/**
 * Provider catalog for the Integrations Hub. Data lives in catalog.json so the video worker
 * (plain Node) reads exactly the same pricing classification and LLM endpoints.
 * Dependency-free: usable from server, client and Node's test runner.
 */
import data from "./catalog.json" with { type: "json" };

export type ProviderCategory = "ai" | "voice" | "stock" | "creative" | "publishing" | "storage";
export type ProviderAuth = "api_key" | "oauth" | "manual" | "none" | "builtin";
/** free: no charge · free_tier: free allowance, then billed · paid: always billed */
export type ProviderPricing = "free" | "free_tier" | "paid";
/** available: implemented here · builtin: part of StoryFlow/AVG · manual: no API · requires_approval: platform approval needed */
export type ProviderStatus = "available" | "builtin" | "manual" | "requires_approval";

export interface LlmConfig {
  api: "anthropic" | "openai" | "gemini";
  baseUrl: string;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  category: ProviderCategory;
  auth: ProviderAuth;
  pricing: ProviderPricing;
  status: ProviderStatus;
  usage: string;
  docsUrl: string;
  pricingUrl?: string;
  keyUrl?: string;
  license?: string;
  approval?: string;
  scopes?: string[];
  uses: string[];
  llm?: LlmConfig;
}

export const PROVIDERS = data.providers as ProviderDefinition[];

export const CATEGORIES: Array<{ id: ProviderCategory; label: string; description: string }> = [
  { id: "ai", label: "AI Models", description: "Language and image models. Keys are yours, encrypted, and used only for your renders." },
  { id: "voice", label: "Voice & Audio", description: "Narration and audio. Renders use the engine's built-in voices and music." },
  { id: "stock", label: "Stock Media", description: "Search licensed photos and videos with creator and licence details." },
  { id: "creative", label: "Creative Tools", description: "Official integrations where available; manual workflows otherwise." },
  { id: "publishing", label: "Publishing", description: "Official platform APIs. Each platform must approve the app first." },
  { id: "storage", label: "Storage", description: "Where finished videos and assets are kept." },
];

export const PRICING_LABEL: Record<ProviderPricing, string> = {
  free: "Free",
  free_tier: "Free tier",
  paid: "Paid",
};

export function getProvider(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Providers whose API keys users store (encrypted) in workspace_provider_credentials. */
export const KEY_PROVIDER_IDS = PROVIDERS.filter((p) => p.auth === "api_key").map((p) => p.id);

/** Language models usable for scene planning. */
export const LLM_PROVIDER_IDS = PROVIDERS.filter((p) => p.llm).map((p) => p.id);

export function isKeyProvider(id: string) {
  return KEY_PROVIDER_IDS.includes(id);
}

export function isLlmProvider(id: string) {
  return LLM_PROVIDER_IDS.includes(id);
}

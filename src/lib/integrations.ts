import type { IntegrationProvider } from "@/lib/types";

export interface IntegrationField {
  key: string;
  label: string;
  placeholder: string;
  help?: string;
  type?: "text" | "url";
}

export interface IntegrationDefinition {
  provider: IntegrationProvider;
  name: string;
  category: "Language model" | "Voice" | "Publishing" | "Automation";
  description: string;
  /** Server-only environment variables that hold the credential. Never sent to the browser. */
  envVars: string[];
  fields: IntegrationField[];
  note?: string;
}

/**
 * Workspace settings-only integrations (no credentials). Provider keys and connections live in
 * the Integrations Hub catalog (src/lib/integrations/catalog.json).
 */
export const INTEGRATIONS: IntegrationDefinition[] = [
  {
    provider: "webhook",
    name: "Webhook",
    category: "Automation",
    description: "Notify an external endpoint when scripts or projects change.",
    envVars: [],
    fields: [
      {
        key: "url",
        label: "Endpoint URL",
        placeholder: "https://example.com/hooks/storyflow",
        type: "url",
        help: "Must use HTTPS.",
      },
    ],
    note: "Saved now; event delivery ships in a later milestone.",
  },
];

export function getIntegration(provider: string) {
  return INTEGRATIONS.find((i) => i.provider === provider);
}

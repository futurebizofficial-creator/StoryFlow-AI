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

export const INTEGRATIONS: IntegrationDefinition[] = [
  {
    provider: "anthropic",
    name: "Anthropic Claude",
    category: "Language model",
    description: "Script drafting, scene orchestration and render prompts powered by your Claude key.",
    envVars: [],
    fields: [{ key: "default_model", label: "Default model", placeholder: "claude-sonnet-4-5" }],
  },
  {
    provider: "openai",
    name: "OpenAI",
    category: "Language model",
    description: "Alternative language model provider for script generation.",
    envVars: ["OPENAI_API_KEY"],
    fields: [{ key: "default_model", label: "Default model", placeholder: "Model identifier" }],
  },
  {
    provider: "elevenlabs",
    name: "ElevenLabs",
    category: "Voice",
    description: "Voiceover synthesis for narrated scripts.",
    envVars: ["ELEVENLABS_API_KEY"],
    fields: [{ key: "default_voice_id", label: "Default voice ID", placeholder: "e.g. 21m00Tcm4TlvDq8ikWAM" }],
  },
  {
    provider: "youtube",
    name: "YouTube",
    category: "Publishing",
    description: "Publish finished videos to a connected channel.",
    envVars: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"],
    fields: [{ key: "channel_handle", label: "Channel handle", placeholder: "@yourchannel" }],
    note: "Channel OAuth connection is not part of Milestone 1.",
  },
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

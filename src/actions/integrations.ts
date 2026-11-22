"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { getIntegration } from "@/lib/integrations";
import type { ActionState } from "@/lib/types";

export async function saveIntegrationAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getWorkspaceContext();
  if (!ctx.canManage) return { error: "Only owners and admins can change integrations." };

  const definition = getIntegration(String(formData.get("provider") ?? ""));
  if (!definition) return { error: "Unknown integration." };

  const settings: Record<string, string> = {};
  for (const field of definition.fields) {
    const value = String(formData.get(field.key) ?? "").trim();
    if (value.length > 300) return { fieldErrors: { [field.key]: "Keep this under 300 characters." } };
    if (value && field.type === "url") {
      try {
        const url = new URL(value);
        if (url.protocol !== "https:") throw new Error();
      } catch {
        return { fieldErrors: { [field.key]: "Enter a valid HTTPS URL." } };
      }
    }
    if (value) settings[field.key] = value;
  }

  const enabled = formData.get("enabled") === "on";

  const supabase = await createClient();
  const { error } = await supabase.from("workspace_integrations").upsert(
    {
      workspace_id: ctx.current.workspace.id,
      provider: definition.provider,
      enabled,
      settings,
      updated_by: ctx.user.id,
    },
    { onConflict: "workspace_id,provider" },
  );
  if (error) return { error: error.message };

  revalidatePath("/settings/integrations");
  return { success: `${definition.name} settings saved.` };
}

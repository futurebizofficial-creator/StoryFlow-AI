import { saveProviderCredentialAction } from "@/actions/video";
import { Card, Field, Input, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/form";

export function ProviderCredentials({ configured }: { configured: string[] }) {
  return (
    <section className="mb-8 space-y-4">
      <PageHeader eyebrow="Bring your own key" title="AI providers" description="Keys are encrypted before storage and belong to your user account in this workspace." />
      <div className="grid gap-4 md:grid-cols-2">
        {([ ["anthropic", "Claude API key"], ["gemini", "Gemini API key"] ] as const).map(([provider, label]) => (
          <Card key={provider} className="p-5">
            <p className="mb-3 text-sm font-medium">{label} · {configured.includes(provider) ? "Configured" : "Not configured"}</p>
            <form action={saveProviderCredentialAction} className="space-y-3">
              <input type="hidden" name="provider" value={provider} />
              <Field label="API key" htmlFor={`${provider}-key`}>
                <Input id={`${provider}-key`} name="apiKey" type="password" autoComplete="new-password" required maxLength={500} />
              </Field>
              <SubmitButton size="sm" pendingText="Encrypting…">Save key</SubmitButton>
            </form>
          </Card>
        ))}
      </div>
    </section>
  );
}

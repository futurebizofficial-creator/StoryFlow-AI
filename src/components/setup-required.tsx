import { Logo } from "@/components/icons";
import { Card } from "@/components/ui";

const steps = [
  "Create a Supabase project at supabase.com.",
  "Run the SQL in supabase/migrations/ (Supabase CLI: `supabase db push`, or paste into the SQL editor).",
  "Copy .env.example to .env.local and fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
  "Restart the server.",
];

/** Shown instead of auth/app pages when Supabase environment variables are missing. */
export function SetupRequired() {
  return (
    <main className="glow grid min-h-dvh place-items-center px-4 py-16">
      <Card className="w-full max-w-lg p-7">
        <Logo />
        <h1 className="mt-6 text-xl font-semibold tracking-tight">Connect Supabase to continue</h1>
        <p className="mt-1.5 text-sm text-muted">
          StoryFlow AI uses Supabase for authentication and data. This server has no Supabase
          credentials configured yet, so sign-in and workspaces are unavailable.
        </p>
        <ol className="mt-5 space-y-3">
          {steps.map((step, i) => (
            <li key={step} className="flex gap-3 text-sm">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                {i + 1}
              </span>
              <span className="pt-0.5 text-fg-2">{step}</span>
            </li>
          ))}
        </ol>
      </Card>
    </main>
  );
}

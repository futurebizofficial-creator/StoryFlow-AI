import Link from "next/link";
import { Logo } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { SetupRequired } from "@/components/setup-required";
import { isSupabaseConfigured } from "@/lib/env";
import { connection } from "next/server";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  await connection();
  if (!isSupabaseConfigured()) return <SetupRequired />;

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="StoryFlow AI home">
            <Logo />
          </Link>
          <ThemeToggle />
        </div>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[380px]">{children}</div>
        </main>
        <p className="text-center text-xs text-muted">
          © {new Date().getFullYear()} StoryFlow AI
        </p>
      </div>

      <aside className="relative hidden overflow-hidden border-l border-border bg-surface lg:block">
        <div className="bg-grid absolute inset-0 opacity-70" />
        <div className="glow absolute inset-0" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <div />
          <div>
            <p className="font-display text-[44px] leading-[1.05] tracking-tight text-fg italic">
              From idea to script,
              <br />
              <span className="text-gradient not-italic">in one flow.</span>
            </p>
            <p className="mt-5 max-w-md text-[15px] text-muted">
              Plan projects, write scripts with your team, and keep every workspace private by
              design.
            </p>
          </div>
          <div className="grid gap-3">
            {[
              ["Script Studio", "Scene-aware editor with live pacing estimates"],
              ["Workspaces", "Separate teams with Owner, Admin and Member roles"],
              ["Secure by default", "Row-level security isolates every workspace"],
            ].map(([title, desc]) => (
              <div
                key={title}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface/70 px-4 py-3 backdrop-blur"
              >
                <span className="size-2 rounded-full bg-accent" />
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-xs text-muted">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

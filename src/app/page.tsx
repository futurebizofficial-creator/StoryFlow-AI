import Link from "next/link";
import { connection } from "next/server";
import { Icon, Logo, type IconName } from "@/components/icons";
import { ButtonLink } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { isSupabaseConfigured } from "@/lib/env";
import { getUser } from "@/lib/auth";

const FEATURES: Array<{ icon: IconName; title: string; body: string }> = [
  { icon: "pen", title: "Script Studio", body: "A focused, scene-aware editor with live pacing against your target runtime." },
  { icon: "folder", title: "Projects", body: "Organise every video, campaign and series with status tracking your team shares." },
  { icon: "users", title: "Team workspaces", body: "Invite collaborators as Owners, Admins or Members. Switch workspaces in a click." },
  { icon: "shield", title: "Isolated by design", body: "Row-level security in Postgres keeps each workspace's data private to its members." },
];

export default async function Home() {
  await connection();
  const user = isSupabaseConfigured() ? await getUser().catch(() => null) : null;

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-x-0 top-0 h-[640px]" />
      <div className="glow pointer-events-none absolute inset-x-0 top-0 h-[640px]" />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <nav className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle className="hidden sm:inline-flex" />
          {user ? (
            <ButtonLink href="/dashboard" size="sm">
              Open dashboard
            </ButtonLink>
          ) : (
            <>
              <Link href="/login" className="px-2 text-sm font-medium text-fg-2 hover:text-fg">
                Sign in
              </Link>
            </>
          )}
        </nav>
      </header>

      <main className="relative">
        <section className="mx-auto max-w-4xl px-5 pt-16 pb-20 text-center sm:px-8 sm:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/80 px-3 py-1 text-xs font-medium text-fg-2 backdrop-blur">
            <Icon name="sparkles" size={13} className="text-accent" /> The story studio for video teams
          </span>
          <h1 className="mt-6 text-[40px] leading-[1.05] font-semibold tracking-[-0.03em] text-balance sm:text-[64px]">
            Turn ideas into{" "}
            <span className="font-display font-normal tracking-normal italic">scripts</span>{" "}
            <span className="text-gradient">your team can ship.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base text-muted sm:text-lg">
            StoryFlow AI brings projects, scripts and collaborators into one calm, secure workspace.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <ButtonLink href={user ? "/dashboard" : "/login"} size="lg">
              {user ? "Go to dashboard" : "Sign in"} <Icon name="arrowRight" />
            </ButtonLink>
          </div>
          {!user && (
            <p className="mt-4 text-sm text-muted">Access is by invitation. Ask your workspace owner for an invite link.</p>
          )}
        </section>

        <section className="mx-auto max-w-5xl px-5 pb-24 sm:px-8">
          <div className="overflow-hidden rounded-3xl border border-border bg-surface shadow-[var(--shadow-pop)]">
            <div className="flex items-center gap-1.5 border-b border-border px-4 py-3">
              <span className="size-2.5 rounded-full bg-surface-3" />
              <span className="size-2.5 rounded-full bg-surface-3" />
              <span className="size-2.5 rounded-full bg-surface-3" />
              <span className="ml-3 text-xs text-muted">Script Studio — Product launch teaser</span>
            </div>
            <div className="grid md:grid-cols-[minmax(0,1fr)_260px]">
              <div className="space-y-4 p-6 text-left text-[15px] leading-7 sm:p-8">
                <p className="text-xs font-semibold tracking-wide text-accent uppercase">## Hook</p>
                <p className="text-fg-2">What if your next launch video wrote its own outline?</p>
                <p className="text-xs font-semibold tracking-wide text-accent uppercase">## Scene 1 — The problem</p>
                <p className="text-fg-2">
                  Every team has a folder of half-finished scripts. Notes in one app, feedback in another, and nobody
                  knows which draft is final…
                </p>
              </div>
              <div className="border-t border-border bg-surface-2/50 p-6 md:border-t-0 md:border-l">
                <p className="text-[11px] font-medium tracking-wide text-muted uppercase">Pacing</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">0m 42s</p>
                <div className="mt-3 h-1.5 rounded-full bg-surface-3">
                  <div className="h-full w-[70%] rounded-full bg-accent" />
                </div>
                <p className="mt-5 text-[11px] font-medium tracking-wide text-muted uppercase">Outline</p>
                <ol className="mt-2 space-y-1.5 text-[13px] text-fg-2">
                  <li>1 · Hook</li>
                  <li>2 · Scene 1 — The problem</li>
                  <li>3 · Scene 2 — The turn</li>
                </ol>
              </div>
            </div>
          </div>

          <div className="mt-16 grid gap-4 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-border bg-surface p-6">
                <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">
                  <Icon name={f.icon} size={18} />
                </span>
                <h2 className="mt-4 text-[15px] font-semibold">{f.title}</h2>
                <p className="mt-1.5 text-sm text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="relative border-t border-border py-8 text-center text-xs text-muted">
        © {new Date().getFullYear()} StoryFlow AI
      </footer>
    </div>
  );
}

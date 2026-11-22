import { Logo } from "@/components/icons";
import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="glow grid min-h-dvh place-items-center px-4">
      <div className="text-center">
        <Logo withWordmark={false} className="justify-center" />
        <p className="mt-8 font-display text-6xl italic">404</p>
        <h1 className="mt-3 text-lg font-semibold">This page doesn&apos;t exist</h1>
        <p className="mt-1 text-sm text-muted">It may have been moved, deleted, or belong to another workspace.</p>
        <ButtonLink href="/dashboard" className="mt-6" variant="outline">
          Back to dashboard
        </ButtonLink>
      </div>
    </main>
  );
}

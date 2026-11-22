"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-[60dvh] place-items-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-1.5 text-sm text-muted">
          The request could not be completed. {error.digest && <span className="font-mono text-xs">Ref {error.digest}</span>}
        </p>
        <Button onClick={reset} variant="outline" className="mt-6">
          Try again
        </Button>
      </div>
    </main>
  );
}

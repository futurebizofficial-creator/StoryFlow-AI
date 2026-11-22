"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui";
import type { ActionState } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  size = "md",
  className,
  disabled,
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "lg";
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className={buttonClass(variant, size, className)}
    >
      {pending && (
        <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
      )}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

export function FormMessage({ state, className }: { state: ActionState; className?: string }) {
  if (!state.error && !state.success) return null;
  return (
    <p
      role={state.error ? "alert" : "status"}
      className={cn(
        "rounded-lg px-3 py-2 text-[13px]",
        state.error ? "bg-danger-soft text-danger" : "bg-success-soft text-success",
        className,
      )}
    >
      {state.error ?? state.success}
    </p>
  );
}

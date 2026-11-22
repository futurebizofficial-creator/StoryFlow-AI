"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark" | "system";

function apply(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    let saved: Theme = "dark";
    try {
      saved = (localStorage.getItem("sf-theme") as Theme) || "dark";
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync with persisted preference after mount
    setTheme(saved);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      let current: Theme = "dark";
      try {
        current = (localStorage.getItem("sf-theme") as Theme) || "dark";
      } catch {}
      if (current === "system") apply("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const choose = (t: Theme) => {
    setTheme(t);
    try {
      localStorage.setItem("sf-theme", t);
    } catch {}
    apply(t);
  };

  const options: Array<{ value: Theme; icon: "sun" | "moon" | "monitor"; label: string }> = [
    { value: "light", icon: "sun", label: "Light theme" },
    { value: "system", icon: "monitor", label: "System theme" },
    { value: "dark", icon: "moon", label: "Dark theme" },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn("inline-flex rounded-lg border border-border bg-surface-2 p-0.5", className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={theme === o.value}
          aria-label={o.label}
          onClick={() => choose(o.value)}
          className={cn(
            "grid size-7 place-items-center rounded-md text-muted transition-colors",
            theme === o.value ? "bg-surface text-fg shadow-sm" : "hover:text-fg",
          )}
        >
          <Icon name={o.icon} size={14} />
        </button>
      ))}
    </div>
  );
}

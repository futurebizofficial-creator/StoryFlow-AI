"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, Logo, type IconName } from "@/components/icons";
import { Avatar, Badge } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOutAction } from "@/actions/auth";
import { switchWorkspaceAction } from "@/actions/workspace";
import { cn, ROLE_LABEL } from "@/lib/utils";
import type { WorkspaceRole } from "@/lib/types";

export interface ShellWorkspace {
  id: string;
  name: string;
  role: WorkspaceRole;
}

interface ShellProps {
  workspaces: ShellWorkspace[];
  currentId: string;
  user: { name: string; email: string };
  /** Only owners can create workspaces (invite-only; enforced by create_workspace()). */
  canCreateWorkspace?: boolean;
  children: ReactNode;
}

const NAV: Array<{ label: string; items: Array<{ href: string; label: string; icon: IconName }> }> = [
  {
    label: "Create",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
      { href: "/video-studio", label: "AI Video Studio", icon: "sparkles" },
      { href: "/videos", label: "My Videos", icon: "film" },
      { href: "/studio", label: "Script Studio", icon: "pen" },
      { href: "/projects", label: "Projects", icon: "folder" },
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/team", label: "Team", icon: "users" },
      { href: "/settings/integrations", label: "Integrations", icon: "plug" },
      { href: "/settings", label: "Settings", icon: "settings" },
    ],
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/settings") return pathname === "/settings";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function WorkspaceSwitcher({
  workspaces,
  currentId,
  canCreateWorkspace,
}: {
  workspaces: ShellWorkspace[];
  currentId: string;
  canCreateWorkspace?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = workspaces.find((w) => w.id === currentId) ?? workspaces[0];

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-surface px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-fg text-[12px] font-semibold text-bg">
          {current.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{current.name}</span>
          <span className="block text-[11px] text-muted">{ROLE_LABEL[current.role]}</span>
        </span>
        <Icon name="chevronDown" size={14} className="text-muted" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 left-0 z-50 mt-1.5 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-[var(--shadow-pop)]"
        >
          <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">
            Workspaces
          </p>
          <div className="scrollbar-thin max-h-64 overflow-y-auto">
            {workspaces.map((w) => (
              <form key={w.id} action={switchWorkspaceAction}>
                <input type="hidden" name="workspaceId" value={w.id} />
                <button
                  type="submit"
                  role="menuitem"
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-surface-2"
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-md bg-surface-3 text-[11px] font-semibold">
                    {w.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  {w.id === current.id ? (
                    <Icon name="check" size={14} className="text-accent" />
                  ) : (
                    <Badge className="opacity-70">{ROLE_LABEL[w.role]}</Badge>
                  )}
                </button>
              </form>
            ))}
          </div>
          {canCreateWorkspace && (
          <div className="mt-1 border-t border-border pt-1">
            <Link
              href="/onboarding?new=1"
              onClick={() => setOpen(false)}
              role="menuitem"
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-fg-2 hover:bg-surface-2 hover:text-fg"
            >
              <Icon name="plus" size={14} /> Create workspace
            </Link>
          </div>
          )}
        </div>
      )}
    </div>
  );
}

function SidebarContent({ workspaces, currentId, user, canCreateWorkspace, onNavigate }: Omit<ShellProps, "children"> & { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-5 pb-4">
        <Link href="/dashboard" onClick={onNavigate} aria-label="StoryFlow AI overview">
          <Logo />
        </Link>
      </div>
      <div className="px-3">
        <WorkspaceSwitcher workspaces={workspaces} currentId={currentId} canCreateWorkspace={canCreateWorkspace} />
      </div>

      <nav className="mt-5 flex-1 space-y-6 overflow-y-auto px-3" aria-label="Main">
        {NAV.map((group) => (
          <div key={group.label}>
            <p className="px-2.5 pb-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] font-medium transition-colors",
                        active
                          ? "bg-gradient-to-r from-accent-soft to-surface text-fg ring-1 ring-accent/25"
                          : "text-fg-2 hover:bg-surface-2 hover:text-fg",
                      )}
                    >
                      {active && <span className="bg-brand absolute top-1.5 bottom-1.5 -left-3 w-[3px] rounded-r-full" aria-hidden="true" />}
                      <Icon name={item.icon} className={cn(active ? "text-accent" : "text-muted group-hover:text-fg")} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[11px] font-medium tracking-wide text-muted uppercase">Theme</span>
          <ThemeToggle />
        </div>
        <div className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5">
          <Avatar name={user.name || user.email} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{user.name || user.email.split("@")[0]}</p>
            <p className="truncate text-[11.5px] text-muted">{user.email}</p>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
            >
              <Icon name="logout" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export function AppShell(props: ShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const current = props.workspaces.find((w) => w.id === props.currentId);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh border-r border-border bg-surface/40 backdrop-blur-xl lg:block">
        <SidebarContent {...props} />
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur-md lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          className="grid size-9 place-items-center rounded-lg border border-border bg-surface"
        >
          <Icon name="menu" />
        </button>
        <Logo withWordmark={false} />
        <span className="min-w-0 truncate text-sm font-semibold">{current?.name}</span>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[85%] max-w-[300px] border-r border-border bg-bg shadow-[var(--shadow-pop)]">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
              className="absolute top-5 right-3 z-10 grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2"
            >
              <Icon name="x" />
            </button>
            <SidebarContent {...props} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <main className="min-w-0">{props.children}</main>
    </div>
  );
}

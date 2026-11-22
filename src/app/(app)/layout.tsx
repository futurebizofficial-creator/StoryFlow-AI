import { connection } from "next/server";
import { AppShell } from "@/components/app-shell";
import { SetupRequired } from "@/components/setup-required";
import { isSupabaseConfigured } from "@/lib/env";
import { getWorkspaceContext } from "@/lib/workspace";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await connection();
  if (!isSupabaseConfigured()) return <SetupRequired />;

  const ctx = await getWorkspaceContext();

  return (
    <AppShell
      workspaces={ctx.memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: m.role }))}
      currentId={ctx.current.workspace.id}
      user={{ name: ctx.profile?.full_name ?? "", email: ctx.user.email }}
    >
      {children}
    </AppShell>
  );
}

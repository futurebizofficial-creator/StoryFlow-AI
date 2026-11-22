import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { PageContainer } from "@/components/page";
import { PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { StockSearch } from "@/components/stock-search";

export const metadata: Metadata = { title: "Stock media search" };

export default async function StockSearchPage() {
  const ctx = await getWorkspaceContext();
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspace_provider_credentials")
    .select("provider")
    .eq("workspace_id", ctx.current.workspace.id)
    .eq("user_id", ctx.user.id);

  return (
    <PageContainer className="max-w-7xl">
      <PageHeader
        eyebrow="Integrations"
        title="Stock media search"
        description="Search official stock APIs with your own keys. Every result keeps its creator, source and licence. The render engine picks its own footage during rendering."
        actions={
          <Link href="/settings/integrations#stock" className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-border-strong bg-surface px-3.5 text-sm font-medium hover:bg-surface-2">
            <Icon name="chevronLeft" /> Integrations Hub
          </Link>
        }
      />
      <StockSearch savedKeys={(data ?? []).map((r) => r.provider)} />
    </PageContainer>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { PageContainer } from "@/components/page";
import { Card, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ProjectForm } from "@/components/project-forms";

export const metadata: Metadata = { title: "New project" };

export default function NewProjectPage() {
  return (
    <PageContainer className="max-w-2xl">
      <Link href="/projects" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <Icon name="chevronLeft" size={14} /> Projects
      </Link>
      <PageHeader title="New project" description="Give the project a clear name so your team can find it." />
      <Card className="p-6">
        <ProjectForm />
      </Card>
    </PageContainer>
  );
}

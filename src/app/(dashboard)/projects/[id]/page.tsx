import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current-user";
import { ProjectDetail } from "@/components/projects/project-detail";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  if (!/^[a-f\d]{24}$/i.test(id)) notFound();
  await requirePermission("project:read");
  return <ProjectDetail id={id} />;
}

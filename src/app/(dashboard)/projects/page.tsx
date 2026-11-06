import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { ProjectsView } from "@/components/projects/projects-view";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  await requirePermission("project:read");
  return <ProjectsView />;
}

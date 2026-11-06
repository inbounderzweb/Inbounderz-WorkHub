import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { TasksView } from "@/components/tasks/tasks-view";

export const metadata: Metadata = { title: "All Tasks" };

export default async function AllTasksPage() {
  await requirePermission("task:manage");
  return <TasksView scope="all" />;
}

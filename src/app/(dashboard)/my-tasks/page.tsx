import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { TasksView } from "@/components/tasks/tasks-view";

export const metadata: Metadata = { title: "My Tasks" };

export default async function MyTasksPage() {
  await requirePermission("task:read");
  return <TasksView scope="mine" />;
}

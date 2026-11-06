import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current-user";
import { TaskDetail } from "@/components/tasks/task-detail";

export const metadata: Metadata = { title: "Task" };

export default async function TaskPage({ params }: PageProps<"/tasks/[id]">) {
  const { id } = await params;
  if (!/^[a-f\d]{24}$/i.test(id)) notFound();
  await requirePermission("task:read");
  return <TaskDetail id={id} />;
}

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/current-user";
import { connectDB } from "@/lib/db";
import { Task } from "@/models";
import { TaskDetail } from "@/components/tasks/task-detail";

export const metadata: Metadata = { title: "Task" };

export default async function TaskPage({ params }: PageProps<"/tasks/[id]">) {
  const { id } = await params;
  if (!/^[a-f\d]{24}$/i.test(id)) notFound();
  await requirePermission("task:read");
  // An internal-request task is worked on from its ticket (the single source of truth).
  await connectDB();
  const task = await Task.findById(id).select("linkedTicket").lean();
  if (task?.linkedTicket) redirect(`/tickets/${task.linkedTicket}?from=task`);
  return <TaskDetail id={id} />;
}

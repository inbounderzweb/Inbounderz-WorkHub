import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { MyWorkView } from "@/components/tasks/my-work-view";
import { Task, Ticket } from "@/models";
import { Types } from "mongoose";

export const metadata: Metadata = { title: "My Tasks" };

export default async function MyTasksPage() {
  const user = await requirePermission("task:read");
  const self = new Types.ObjectId(user.id);
  const [taskCount, ticketCount] = await Promise.all([
    Task.countDocuments({ $or: [{ owner: self }, { collaborators: self }] }),
    Ticket.countDocuments({ assignee: self, status: { $nin: ["DRAFT", "COMPLETED", "REJECTED", "CANCELLED"] } }),
  ]);
  return <MyWorkView initialTaskCount={taskCount} initialTicketCount={ticketCount} />;
}

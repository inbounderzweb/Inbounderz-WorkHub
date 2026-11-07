import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { TicketsView } from "@/components/tickets/tickets-view";

export const metadata: Metadata = { title: "Ticket Management" };

export default async function TicketManagementPage() {
  await requirePermission("ticket:monitor");
  return <TicketsView scope="manage" />;
}

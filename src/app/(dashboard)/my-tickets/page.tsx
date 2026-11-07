import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { TicketsView } from "@/components/tickets/tickets-view";

export const metadata: Metadata = { title: "My Tickets" };

export default async function MyTicketsPage() {
  await requirePermission("ticket:create");
  return <TicketsView scope="mine" />;
}

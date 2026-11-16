import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { TicketsView } from "@/components/tickets/tickets-view";

export const metadata: Metadata = { title: "Tickets" };

export default async function TicketsPage({ searchParams }: PageProps<"/tickets">) {
  await requirePermission("ticket:create");
  const { scope } = await searchParams;
  return <TicketsView initialScope={scope === "queue" || scope === "employee" ? scope : "raised"} />;
}

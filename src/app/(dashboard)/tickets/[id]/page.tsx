import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { DetailSkeleton } from "@/components/shared/skeletons";
import { TicketDetail } from "@/components/tickets/ticket-detail";

export const metadata: Metadata = { title: "Ticket" };

// Access (requester, assignee, managers, department heads) is checked by the API per ticket.
export default async function TicketPage({ params }: PageProps<"/tickets/[id]">) {
  const { id } = await params;
  if (!/^[a-f\d]{24}$/i.test(id)) notFound();
  await requireUser();
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <TicketDetail id={id} />
    </Suspense>
  );
}

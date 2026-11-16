import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { reorderTicketSchema } from "@/lib/validations/ticket";
import { reorderTicket } from "@/services/ticket-queue.service";

/** Manager-only: move a ticket to a position in its assignee's queue. Rights are re-checked in the service. */
export const POST = withAuth<RouteContext<"/api/tickets/[id]/reorder">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  const { position } = await parseBody(req, reorderTicketSchema);
  return reorderTicket(user, id, position);
}, { permission: "ticket:manage" });

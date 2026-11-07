import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { ticketActionSchema } from "@/lib/validations/ticket";
import { getTicket, performTicketAction } from "@/services/ticket.service";

/** Workflow transitions (review, request/provide info, start, resolve, accept, request changes, reject, reopen). */
export const POST = withAuth<RouteContext<"/api/tickets/[id]/actions">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  await performTicketAction(user, id, await parseBody(req, ticketActionSchema));
  return getTicket(user, id);
});

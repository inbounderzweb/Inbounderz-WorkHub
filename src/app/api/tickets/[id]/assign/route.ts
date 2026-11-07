import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { assignTicketSchema } from "@/lib/validations/ticket";
import { assignTicket, getTicket } from "@/services/ticket.service";

/** Assign (first time) or reassign. Creates/updates the linked task in the assignee's My Tasks. */
export const POST = withAuth<RouteContext<"/api/tickets/[id]/assign">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  await assignTicket(user, id, await parseBody(req, assignTicketSchema));
  return getTicket(user, id);
}, { permission: "ticket:manage" });

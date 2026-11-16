import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { ticketActionSchema } from "@/lib/validations/ticket";
import { ticketAction } from "@/services/ticket.service";

/**
 * The only way to change a ticket's state. Approval, assignment and every other transition are
 * validated against the caller's rights and the ticket's current status in the service layer.
 */
export const POST = withAuth<RouteContext<"/api/tickets/[id]/actions">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  await ticketAction(user, id, await parseBody(req, ticketActionSchema));
  return { ok: true };
}, { permission: "ticket:create" });

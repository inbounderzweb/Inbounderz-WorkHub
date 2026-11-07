import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { updateTicketSchema } from "@/lib/validations/ticket";
import { getTicket, updateTicket } from "@/services/ticket.service";

type Ctx = RouteContext<"/api/tickets/[id]">;

export const GET = withAuth<Ctx>(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return getTicket(user, id);
});

// Managing Project Manager / Super Admin only (enforced in the service).
export const PATCH = withAuth<Ctx>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  await updateTicket(user, id, await parseBody(req, updateTicketSchema));
  return getTicket(user, id);
});

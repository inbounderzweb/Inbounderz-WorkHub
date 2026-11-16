import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { updateTicketSchema } from "@/lib/validations/ticket";
import { getTicket, updateTicket } from "@/services/ticket.service";

export const GET = withAuth<RouteContext<"/api/tickets/[id]">>(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return getTicket(user, id);
}, { permission: "ticket:create" });

export const PATCH = withAuth<RouteContext<"/api/tickets/[id]">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  await updateTicket(user, id, await parseBody(req, updateTicketSchema));
  return { ok: true };
}, { permission: "ticket:create" });

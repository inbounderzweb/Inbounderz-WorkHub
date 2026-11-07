import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { ticketCommentSchema } from "@/lib/validations/ticket";
import { addTicketComment } from "@/services/ticket.service";

export const POST = withAuth<RouteContext<"/api/tickets/[id]/comments">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  await addTicketComment(user, id, (await parseBody(req, ticketCommentSchema)).body);
  return Response.json({ ok: true }, { status: 201 });
});

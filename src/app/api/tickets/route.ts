import { parseBody, parseQuery, withAuth } from "@/lib/api";
import { createTicketSchema, ticketListQuerySchema } from "@/lib/validations/ticket";
import { createTicket, listTickets } from "@/services/ticket.service";

export const GET = withAuth(async (req, _ctx, user) => listTickets(user, parseQuery(req, ticketListQuerySchema)), { permission: "ticket:create" });

export const POST = withAuth(async (req, _ctx, user) => {
  const body = await parseBody(req, createTicketSchema);
  const created = await createTicket(user, body);
  return Response.json(created, { status: 201 });
}, { permission: "ticket:create" });

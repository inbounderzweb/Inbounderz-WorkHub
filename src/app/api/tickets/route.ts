import { parseBody, parseQuery, withAuth } from "@/lib/api";
import { createTicketSchema, ticketListQuerySchema } from "@/lib/validations/ticket";
import { createTicket, listTickets } from "@/services/ticket.service";

// scope=mine → tickets I raised; scope=manage → the management queue (scope enforced in the service).
export const GET = withAuth(async (req, _ctx, user) => listTickets(user, parseQuery(req, ticketListQuerySchema)), {
  permission: "ticket:create",
});

export const POST = withAuth(
  async (req, _ctx, user) => Response.json(await createTicket(user, await parseBody(req, createTicketSchema)), { status: 201 }),
  { permission: "ticket:create" }
);

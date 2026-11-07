import { z } from "zod";
import { parseQuery, withAuth } from "@/lib/api";
import { ticketSummary } from "@/services/ticket.service";

const schema = z.object({ scope: z.enum(["mine", "manage"]).optional().default("mine") });

export const GET = withAuth(async (req, _ctx, user) => ticketSummary(user, parseQuery(req, schema).scope), {
  permission: "ticket:create",
});

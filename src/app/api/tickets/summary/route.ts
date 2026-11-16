import { withAuth } from "@/lib/api";
import { ticketSummary } from "@/services/ticket.service";

export const GET = withAuth(async (_req, _ctx, user) => ticketSummary(user), { permission: "ticket:create" });

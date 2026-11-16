import { assertObjectId, badRequest, withAuth } from "@/lib/api";
import { reviewerOptions } from "@/services/ticket.service";

/** People who can review a ticket's work. Limited to those who assign it (Project Manager, Department Head, Super Admin). */
export const GET = withAuth(async (req, _ctx, user) => {
  const ticket = req.nextUrl.searchParams.get("ticket") ?? "";
  if (!ticket) throw badRequest("ticket is required");
  assertObjectId(ticket, "ticket");
  return reviewerOptions(user, ticket);
}, { permission: "ticket:create" });

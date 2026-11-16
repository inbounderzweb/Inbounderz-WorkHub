import { assertObjectId, badRequest, withAuth } from "@/lib/api";
import { getWorkload } from "@/services/ticket.service";

/** Employee workload for a department. Limited to its Project Managers, its Head and Super Admins. */
export const GET = withAuth(async (req, _ctx, user) => {
  const department = req.nextUrl.searchParams.get("department") ?? "";
  if (!department) throw badRequest("department is required");
  assertObjectId(department, "department");
  const ticket = req.nextUrl.searchParams.get("ticket") ?? "";
  if (ticket) assertObjectId(ticket, "ticket");
  return getWorkload(user, department, ticket || undefined);
}, { permission: "ticket:create" });

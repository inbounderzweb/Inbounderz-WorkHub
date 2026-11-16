import { assertObjectId, withAuth } from "@/lib/api";
import { employeeWorkloadDetail } from "@/services/workload.service";

/** One person's workload breakdown. Open to ticket:create so a Department Head assigning a ticket can look too; the service checks scope. */
export const GET = withAuth<RouteContext<"/api/workload/employees/[id]">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  const period = req.nextUrl.searchParams.get("period") === "month" ? "month" : "week";
  return employeeWorkloadDetail(user, id, period);
}, { permission: "ticket:create" });

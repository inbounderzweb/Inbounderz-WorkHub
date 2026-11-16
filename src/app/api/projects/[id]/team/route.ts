import { assertObjectId, withAuth } from "@/lib/api";
import { getProjectTeam } from "@/services/project.service";

/** Active project team, optionally filtered to one department (?department=). */
export const GET = withAuth<RouteContext<"/api/projects/[id]/team">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  const department = req.nextUrl.searchParams.get("department") ?? "";
  if (department) assertObjectId(department, "department");
  // ?staff=1 also lists the department's own active employees (not yet allocated), for assigning tasks.
  const staff = ["1", "true"].includes(req.nextUrl.searchParams.get("staff") ?? "");
  return getProjectTeam(user, id, department || undefined, staff);
}, { permission: "project:read" });

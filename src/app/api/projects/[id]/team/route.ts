import { assertObjectId, withAuth } from "@/lib/api";
import { getProjectTeam } from "@/services/project.service";

/** Active project team, optionally filtered to one department (?department=). */
export const GET = withAuth<RouteContext<"/api/projects/[id]/team">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  const department = req.nextUrl.searchParams.get("department") ?? "";
  if (department) assertObjectId(department, "department");
  return getProjectTeam(user, id, department || undefined);
}, { permission: "project:read" });

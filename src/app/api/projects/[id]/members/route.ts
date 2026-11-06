import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { projectMembersSchema } from "@/lib/validations/project";
import { updateProjectMembers } from "@/services/project.service";

export const POST = withAuth<RouteContext<"/api/projects/[id]/members">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return updateProjectMembers(user, id, await parseBody(req, projectMembersSchema));
}, { permission: "project:manage" });

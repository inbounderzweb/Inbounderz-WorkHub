import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { createMilestoneSchema } from "@/lib/validations/project";
import { createMilestone } from "@/services/project.service";

export const POST = withAuth<RouteContext<"/api/projects/[id]/milestones">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return Response.json(await createMilestone(user, id, await parseBody(req, createMilestoneSchema)), { status: 201 });
}, { permission: "project:manage" });

import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { updateMilestoneSchema } from "@/lib/validations/project";
import { deleteMilestone, updateMilestone } from "@/services/project.service";

type Ctx = RouteContext<"/api/projects/[id]/milestones/[milestoneId]">;

export const PATCH = withAuth<Ctx>(async (req, ctx, user) => {
  const { id, milestoneId } = await ctx.params;
  assertObjectId(id);
  assertObjectId(milestoneId, "milestone");
  await updateMilestone(user, id, milestoneId, await parseBody(req, updateMilestoneSchema));
  return { ok: true };
}, { permission: "project:manage" });

export const DELETE = withAuth<Ctx>(async (_req, ctx, user) => {
  const { id, milestoneId } = await ctx.params;
  assertObjectId(id);
  assertObjectId(milestoneId, "milestone");
  await deleteMilestone(user, id, milestoneId);
  return { ok: true };
}, { permission: "project:manage" });

import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { workApprovalSchema } from "@/lib/validations/task";
import { workApprovalAction } from "@/services/task.service";

export const POST = withAuth<RouteContext<"/api/tasks/[id]/work-approval">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  await workApprovalAction(user, id, await parseBody(req, workApprovalSchema));
  return { ok: true };
}, { permission: "task:manage" });

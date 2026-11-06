import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { taskReviewSchema } from "@/lib/validations/task";
import { reviewTask } from "@/services/task.service";

export const POST = withAuth<RouteContext<"/api/tasks/[id]/review">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  const body = await parseBody(req, taskReviewSchema);
  await reviewTask(user, id, body.decision, body.comment);
  return { ok: true };
}, { permission: "task:read" });

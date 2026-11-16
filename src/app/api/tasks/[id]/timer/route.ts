import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { taskTimerSchema } from "@/lib/validations/task";
import { setTimer } from "@/services/task.service";

/** Start / pause the work timer. Only the task owner may call it. */
export const POST = withAuth<RouteContext<"/api/tasks/[id]/timer">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  const body = await parseBody(req, taskTimerSchema);
  await setTimer(user, id, body.action, body.reason);
  return { ok: true };
}, { permission: "task:update-status" });

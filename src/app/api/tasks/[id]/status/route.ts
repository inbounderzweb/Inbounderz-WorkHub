import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { taskStatusSchema } from "@/lib/validations/task";
import { changeTaskStatus } from "@/services/task.service";

export const PATCH = withAuth<RouteContext<"/api/tasks/[id]/status">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  const body = await parseBody(req, taskStatusSchema);
  await changeTaskStatus(user, id, body.status, body.note);
  return { ok: true };
}, { permission: "task:update-status" });

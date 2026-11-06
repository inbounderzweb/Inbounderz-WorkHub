import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { taskBlockerSchema } from "@/lib/validations/task";
import { setBlocker } from "@/services/task.service";

export const POST = withAuth<RouteContext<"/api/tasks/[id]/blocker">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  const body = await parseBody(req, taskBlockerSchema);
  await setBlocker(user, id, body.action, body.reason);
  return { ok: true };
}, { permission: "task:read" });

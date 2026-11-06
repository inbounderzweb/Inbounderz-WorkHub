import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { assignTaskSchema } from "@/lib/validations/task";
import { assignTask } from "@/services/task.service";

export const POST = withAuth<RouteContext<"/api/tasks/[id]/assign">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  const body = await parseBody(req, assignTaskSchema);
  await assignTask(user, id, body);
  return { ok: true };
}, { permission: "task:manage" });

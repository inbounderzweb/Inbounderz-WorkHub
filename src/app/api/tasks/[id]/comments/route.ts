import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { taskCommentSchema } from "@/lib/validations/task";
import { addComment } from "@/services/task.service";

export const POST = withAuth<RouteContext<"/api/tasks/[id]/comments">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  const body = await parseBody(req, taskCommentSchema);
  await addComment(user, id, body.body);
  return { ok: true };
}, { permission: "task:read" });

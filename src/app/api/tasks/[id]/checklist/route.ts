import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { checklistAddSchema } from "@/lib/validations/task";
import { addChecklistItem } from "@/services/task.service";

export const POST = withAuth<RouteContext<"/api/tasks/[id]/checklist">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  const body = await parseBody(req, checklistAddSchema);
  await addChecklistItem(user, id, body.text);
  return { ok: true };
}, { permission: "task:read" });

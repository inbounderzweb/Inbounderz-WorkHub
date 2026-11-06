import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { checklistUpdateSchema } from "@/lib/validations/task";
import { deleteChecklistItem, updateChecklistItem } from "@/services/task.service";

type Ctx = RouteContext<"/api/tasks/[id]/checklist/[itemId]">;

export const PATCH = withAuth<Ctx>(async (req, ctx, user) => {
  const { id, itemId } = await ctx.params;
  assertObjectId(id);
  assertObjectId(itemId, "checklist item");
  await updateChecklistItem(user, id, itemId, await parseBody(req, checklistUpdateSchema));
  return { ok: true };
}, { permission: "task:read" });

export const DELETE = withAuth<Ctx>(async (_req, ctx, user) => {
  const { id, itemId } = await ctx.params;
  assertObjectId(id);
  assertObjectId(itemId, "checklist item");
  await deleteChecklistItem(user, id, itemId);
  return { ok: true };
}, { permission: "task:read" });

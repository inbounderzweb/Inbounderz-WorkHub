import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { updateTaskSchema } from "@/lib/validations/task";
import { getTask, updateTask } from "@/services/task.service";

type Ctx = RouteContext<"/api/tasks/[id]">;

export const GET = withAuth<Ctx>(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return getTask(user, id);
}, { permission: "task:read" });

// Managers may edit all fields; the owner may only log actual hours (enforced in the service).
export const PATCH = withAuth<Ctx>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  await updateTask(user, id, await parseBody(req, updateTaskSchema));
  return getTask(user, id);
}, { permission: "task:read" });

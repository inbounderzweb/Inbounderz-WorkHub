import { parseBody, parseQuery, withAuth } from "@/lib/api";
import { createTaskSchema, taskListQuerySchema } from "@/lib/validations/task";
import { createTask, listTasks } from "@/services/task.service";

export const GET = withAuth(async (req, _ctx, user) => listTasks(user, parseQuery(req, taskListQuerySchema)), {
  permission: "task:read",
});

export const POST = withAuth(
  async (req, _ctx, user) => Response.json(await createTask(user, await parseBody(req, createTaskSchema)), { status: 201 }),
  { permission: "task:manage" }
);

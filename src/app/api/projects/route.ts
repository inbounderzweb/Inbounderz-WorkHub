import { parseBody, parseQuery, withAuth } from "@/lib/api";
import { createProjectSchema, projectListQuerySchema } from "@/lib/validations/project";
import { createProject, listProjects } from "@/services/project.service";

export const GET = withAuth(async (req, _ctx, user) => listProjects(user, parseQuery(req, projectListQuerySchema)), {
  permission: "project:read",
});

export const POST = withAuth(
  async (req, _ctx, user) => Response.json(await createProject(user, await parseBody(req, createProjectSchema)), { status: 201 }),
  { permission: "project:manage" }
);

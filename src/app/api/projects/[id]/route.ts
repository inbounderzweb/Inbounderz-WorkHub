import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { updateProjectSchema } from "@/lib/validations/project";
import { getProject, updateProject } from "@/services/project.service";

type Ctx = RouteContext<"/api/projects/[id]">;

export const GET = withAuth<Ctx>(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return getProject(user, id);
}, { permission: "project:read" });

export const PATCH = withAuth<Ctx>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return updateProject(user, id, await parseBody(req, updateProjectSchema));
}, { permission: "project:manage" });

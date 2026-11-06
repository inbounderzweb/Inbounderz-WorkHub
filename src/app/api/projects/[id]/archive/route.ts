import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { projectArchiveSchema } from "@/lib/validations/project";
import { setProjectArchived } from "@/services/project.service";

export const POST = withAuth<RouteContext<"/api/projects/[id]/archive">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  const { archived } = await parseBody(req, projectArchiveSchema);
  await setProjectArchived(user, id, archived);
  return { ok: true };
}, { permission: "project:manage" });

import { z } from "zod";
import { assertObjectId, parseQuery, withAuth } from "@/lib/api";
import { getProjectActivity } from "@/services/project.service";

const schema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const GET = withAuth<RouteContext<"/api/projects/[id]/activity">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  const { page, pageSize } = parseQuery(req, schema);
  return getProjectActivity(user, id, page, pageSize);
}, { permission: "project:read" });

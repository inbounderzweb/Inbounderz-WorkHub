import { assertObjectId, withAuth } from "@/lib/api";
import { getClientProjects } from "@/services/client.service";

type Ctx = RouteContext<"/api/clients/[id]/projects">;

export const GET = withAuth<Ctx>(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return getClientProjects(user, id);
}, { permission: "client:read" });

import { assertObjectId, parseQuery, withAuth } from "@/lib/api";
import { historyQuerySchema } from "@/lib/validations/client";
import { getClientHistory } from "@/services/client.service";

type Ctx = RouteContext<"/api/clients/[id]/history">;

export const GET = withAuth<Ctx>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return getClientHistory(user, id, parseQuery(req, historyQuerySchema));
}, { permission: "client:read" });

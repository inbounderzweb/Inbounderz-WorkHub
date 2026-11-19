import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { updateClientSchema } from "@/lib/validations/client";
import { getClient, updateClient } from "@/services/client.service";

type Ctx = RouteContext<"/api/clients/[id]">;

export const GET = withAuth<Ctx>(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return getClient(user, id);
}, { permission: "client:read" });

export const PATCH = withAuth<Ctx>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return updateClient(user, id, await parseBody(req, updateClientSchema));
}, { permission: "client:update" });

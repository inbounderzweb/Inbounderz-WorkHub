import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { handoverActionSchema } from "@/lib/validations/handover";
import { getHandover, performHandoverAction } from "@/services/handover.service";

type Ctx = RouteContext<"/api/projects/[id]/handover">;

export const GET = withAuth<Ctx>(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return getHandover(user, id);
}, { permission: "project:read" });

/** submit | nominate (Sales owner, Admin) and accept | reject (the nominated primary PM). Each action re-checks who may do it. */
export const POST = withAuth<Ctx>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return performHandoverAction(user, id, await parseBody(req, handoverActionSchema));
}, { permission: "project:read" });

import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { requirementInputSchema } from "@/lib/clients/service-requirements";
import { syncRequirementsSchema } from "@/lib/validations/handover";
import { addRequirement, listRequirements, syncRequirements } from "@/services/requirement.service";

type Ctx = RouteContext<"/api/clients/[id]/requirements">;

export const GET = withAuth<Ctx>(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return listRequirements(user, id);
}, { permission: "client:read" });

export const POST = withAuth<Ctx>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return Response.json(await addRequirement(user, id, await parseBody(req, requirementInputSchema)), { status: 201 });
}, { permission: "client:update" });

/** Replaces the client's whole requirement list in one atomic save (used by the client form). */
export const PUT = withAuth<Ctx>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  const body = await parseBody(req, syncRequirementsSchema);
  return syncRequirements(user, id, body.requirements, body.expectedUpdatedAt);
}, { permission: "client:update" });

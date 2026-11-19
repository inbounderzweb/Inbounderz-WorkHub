import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { requirementPatchSchema } from "@/lib/validations/handover";
import { removeRequirement, updateRequirement } from "@/services/requirement.service";

type Ctx = RouteContext<"/api/clients/[id]/requirements/[requirementId]">;

export const PATCH = withAuth<Ctx>(async (req, ctx, user) => {
  const { id, requirementId } = await ctx.params;
  assertObjectId(id);
  assertObjectId(requirementId, "requirement id");
  return updateRequirement(user, id, requirementId, await parseBody(req, requirementPatchSchema));
}, { permission: "client:update" });

export const DELETE = withAuth<Ctx>(async (_req, ctx, user) => {
  const { id, requirementId } = await ctx.params;
  assertObjectId(id);
  assertObjectId(requirementId, "requirement id");
  await removeRequirement(user, id, requirementId);
  return { ok: true };
}, { permission: "client:update" });

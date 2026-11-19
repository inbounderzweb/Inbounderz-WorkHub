import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { resolveDuplicateReviewSchema } from "@/lib/validations/client";
import { resolveDuplicateReview } from "@/services/client.service";

type Ctx = RouteContext<"/api/clients/duplicate-reviews/[id]">;

export const PATCH = withAuth<Ctx>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  await resolveDuplicateReview(user, id, await parseBody(req, resolveDuplicateReviewSchema));
}, { permission: "client:manage" });

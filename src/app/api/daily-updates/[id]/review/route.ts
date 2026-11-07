import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { reviewDailyUpdateSchema } from "@/lib/validations/daily-update";
import { getDailyUpdate, reviewDailyUpdate } from "@/services/daily-update.service";

export const POST = withAuth<RouteContext<"/api/daily-updates/[id]/review">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  await reviewDailyUpdate(user, id, await parseBody(req, reviewDailyUpdateSchema));
  return getDailyUpdate(user, id);
});

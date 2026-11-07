import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { updateDailyUpdateSchema } from "@/lib/validations/daily-update";
import { deleteDailyUpdate, getDailyUpdate, updateDailyUpdate } from "@/services/daily-update.service";

type Ctx = RouteContext<"/api/daily-updates/[id]">;

export const GET = withAuth<Ctx>(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return getDailyUpdate(user, id);
});

/** Author edits; editing a report with "changes requested" resubmits it. */
export const PATCH = withAuth<Ctx>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  await updateDailyUpdate(user, id, await parseBody(req, updateDailyUpdateSchema));
  return getDailyUpdate(user, id);
});

export const DELETE = withAuth<Ctx>(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  await deleteDailyUpdate(user, id);
  return { ok: true };
});

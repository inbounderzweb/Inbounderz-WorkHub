import { z } from "zod";
import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { deleteNotification, setRead } from "@/services/notification.service";

type Ctx = RouteContext<"/api/notifications/[id]">;

export const PATCH = withAuth<Ctx>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  const { isRead } = await parseBody(req, z.object({ isRead: z.boolean() }));
  await setRead(user, id, isRead);
  return { ok: true };
});

export const DELETE = withAuth<Ctx>(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  await deleteNotification(user, id);
  return { ok: true };
});

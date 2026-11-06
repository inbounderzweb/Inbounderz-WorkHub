import { z } from "zod";
import { parseBody, parseQuery, withAuth } from "@/lib/api";
import { listNotifications, markAllRead } from "@/services/notification.service";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  unread: z
    .enum(["1", "0", "true", "false", ""])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export const GET = withAuth(async (req, _ctx, user) => listNotifications(user, parseQuery(req, querySchema)));

export const PATCH = withAuth(async (req, _ctx, user) => {
  await parseBody(req, z.object({ action: z.literal("mark-all-read") }));
  return { updated: await markAllRead(user) };
});

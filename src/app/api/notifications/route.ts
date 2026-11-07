import { z } from "zod";
import { parseBody, parseQuery, withAuth } from "@/lib/api";
import { NOTIFICATION_TYPES } from "@/lib/constants";
import { listNotifications, markAllRead } from "@/services/notification.service";
import { maybeRunReminderSweep } from "@/services/reminder.service";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  unread: z
    .enum(["1", "0", "true", "false", ""])
    .optional()
    .transform((v) => v === "1" || v === "true"),
  type: z.union([z.literal(""), z.enum(NOTIFICATION_TYPES)]).optional().default(""),
});

export const GET = withAuth(async (req, _ctx, user) => {
  // The bell polls this endpoint, which makes it a reliable heartbeat for deadline reminders.
  await maybeRunReminderSweep();
  return listNotifications(user, parseQuery(req, querySchema));
});

export const PATCH = withAuth(async (req, _ctx, user) => {
  await parseBody(req, z.object({ action: z.literal("mark-all-read") }));
  return { updated: await markAllRead(user) };
});

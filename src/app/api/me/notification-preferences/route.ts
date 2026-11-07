import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { NOTIFICATION_PREF_KEYS, type NotificationPref } from "@/lib/constants";
import { getNotificationPrefs, setNotificationPrefs } from "@/services/notification.service";

const schema = z.object({ muted: z.array(z.enum(NOTIFICATION_PREF_KEYS as [NotificationPref, ...NotificationPref[]])).max(20) });

/** The signed-in user's own in-app notification preferences. */
export const GET = withAuth(async (_req, _ctx, user) => getNotificationPrefs(user));
export const PUT = withAuth(async (req, _ctx, user) => setNotificationPrefs(user, (await parseBody(req, schema)).muted));

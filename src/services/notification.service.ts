import "server-only";
import type { CurrentUser } from "@/lib/auth/current-user";
import { notFound, paginate } from "@/lib/api";
import { Notification, User } from "@/models";
import { NOTIFICATION_PREF_KEYS, type NotificationPref } from "@/lib/constants";
import type { NotificationDTO, Paginated } from "@/types/dto";
import { oid } from "./scope";
import { USER_REF_FIELDS } from "./mappers";
import { toNotificationDTO } from "./dashboard.service";

export async function listNotifications(
  user: CurrentUser,
  opts: { page: number; pageSize: number; unread: boolean; type?: string }
): Promise<Paginated<NotificationDTO> & { unreadCount: number }> {
  const base = { recipient: oid(user.id) };
  const filter: Record<string, unknown> = opts.unread ? { ...base, isRead: false } : { ...base };
  if (opts.type) filter.type = opts.type;
  const [rows, total, unreadCount] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((opts.page - 1) * opts.pageSize)
      .limit(opts.pageSize)
      .populate("actor", USER_REF_FIELDS)
      .lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ ...base, isRead: false }),
  ]);
  return { ...paginate(rows.map(toNotificationDTO), total, opts.page, opts.pageSize), unreadCount };
}

export async function markAllRead(user: CurrentUser): Promise<number> {
  const res = await Notification.updateMany(
    { recipient: oid(user.id), isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  );
  return res.modifiedCount;
}

/** Recipients can only touch their own notifications. */
export async function setRead(user: CurrentUser, id: string, isRead: boolean): Promise<void> {
  const res = await Notification.updateOne(
    { _id: oid(id), recipient: oid(user.id) },
    { $set: { isRead, readAt: isRead ? new Date() : null } }
  );
  if (!res.matchedCount) throw notFound("Notification not found");
}

export async function deleteNotification(user: CurrentUser, id: string): Promise<void> {
  const res = await Notification.deleteOne({ _id: oid(id), recipient: oid(user.id) });
  if (!res.deletedCount) throw notFound("Notification not found");
}

export async function getNotificationPrefs(user: CurrentUser): Promise<{ muted: NotificationPref[] }> {
  const u = await User.findById(user.id).select("notificationPrefs").lean();
  return { muted: ((u?.notificationPrefs?.muted ?? []) as string[]).filter((k): k is NotificationPref => NOTIFICATION_PREF_KEYS.includes(k as NotificationPref)) };
}

export async function setNotificationPrefs(user: CurrentUser, muted: NotificationPref[]): Promise<{ muted: NotificationPref[] }> {
  const clean = [...new Set(muted)].filter((k) => NOTIFICATION_PREF_KEYS.includes(k));
  await User.updateOne({ _id: oid(user.id) }, { $set: { "notificationPrefs.muted": clean } });
  return { muted: clean };
}

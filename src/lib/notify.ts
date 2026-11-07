import "server-only";
import type { Types } from "mongoose";
import type { NotificationPref, NotificationType } from "./constants";
import { Notification, User } from "@/models";

type Id = Types.ObjectId | string;

export type NotifyInput = {
  recipients: (Id | null | undefined)[];
  actorId?: Id | null;
  type: NotificationType;
  title: string;
  message?: string;
  link?: string;
  entityType?: string;
  entityId?: Id | null;
  /** Preference bucket. Recipients who muted it are skipped. Omit for must-deliver notifications. */
  pref?: NotificationPref;
};

/** Drops recipients who switched this notification category off. */
async function withoutMuted(recipients: string[], pref?: NotificationPref): Promise<string[]> {
  if (!pref || !recipients.length) return recipients;
  const muted = await User.find({ _id: { $in: recipients }, "notificationPrefs.muted": pref }).select("_id").lean();
  const skip = new Set(muted.map((m) => m._id.toString()));
  return recipients.filter((r) => !skip.has(r));
}

/**
 * Creates in-app notifications (database-backed). Never notifies the actor about
 * their own action, and never breaks the business operation that triggered it.
 * Callers pass only people who are authorised to see the linked record.
 */
export async function notify(input: NotifyInput): Promise<void> {
  const actor = input.actorId?.toString();
  const unique = [...new Set(input.recipients.filter(Boolean).map((r) => r!.toString()))].filter((r) => r !== actor);
  try {
    const recipients = await withoutMuted(unique, input.pref);
    if (!recipients.length) return;
    await Notification.insertMany(
      recipients.map((recipient) => ({
        recipient,
        actor: input.actorId ?? null,
        type: input.type,
        title: input.title,
        message: input.message ?? "",
        link: input.link ?? "",
        entityType: input.entityType ?? "",
        entityId: input.entityId ?? null,
        pref: input.pref ?? null,
      }))
    );
  } catch (err) {
    console.error("[notify] failed", err);
  }
}

export type ReminderDoc = {
  recipient: string;
  title: string;
  message: string;
  link: string;
  entityType: string;
  entityId: Id;
  /** Unique per recipient + occurrence, e.g. "task-overdue:<task>:<day>:<user>". */
  dedupeKey: string;
};

/** Inserts reminders, silently skipping ones already delivered. Returns how many were new. */
export async function deliverReminders(docs: ReminderDoc[]): Promise<number> {
  if (!docs.length) return 0;
  const recipients = await withoutMuted([...new Set(docs.map((d) => d.recipient))], "reminders");
  const allowed = new Set(recipients);
  const rows = docs.filter((d) => allowed.has(d.recipient)).map((d) => ({ ...d, type: "REMINDER", pref: "reminders", actor: null }));
  if (!rows.length) return 0;
  try {
    const res = await Notification.insertMany(rows, { ordered: false });
    return res.length;
  } catch (err: unknown) {
    // Duplicate dedupeKey = already reminded: expected. Count the ones that did go in.
    const e = err as { code?: number; insertedDocs?: unknown[]; writeErrors?: { code?: number; err?: { code?: number } }[] };
    const dupOnly = (e.writeErrors ?? []).every((w) => (w.code ?? w.err?.code) === 11000);
    if (e.code === 11000 || dupOnly) return e.insertedDocs?.length ?? 0;
    console.error("[reminders] failed", err);
    return 0;
  }
}

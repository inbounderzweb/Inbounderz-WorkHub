import "server-only";
import type { Types } from "mongoose";
import type { NotificationType } from "./constants";
import { Notification } from "@/models";

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
};

/** Creates in-app notifications. Never notifies the actor about their own action. */
export async function notify(input: NotifyInput): Promise<void> {
  const actor = input.actorId?.toString();
  const unique = [...new Set(input.recipients.filter(Boolean).map((r) => r!.toString()))].filter(
    (r) => r !== actor
  );
  if (!unique.length) return;
  try {
    await Notification.insertMany(
      unique.map((recipient) => ({
        recipient,
        actor: input.actorId ?? null,
        type: input.type,
        title: input.title,
        message: input.message ?? "",
        link: input.link ?? "",
        entityType: input.entityType ?? "",
        entityId: input.entityId ?? null,
      }))
    );
  } catch (err) {
    console.error("[notify] failed", err);
  }
}

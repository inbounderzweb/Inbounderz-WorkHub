import { Schema, type InferSchemaType, type Types } from "mongoose";
import { NOTIFICATION_TYPES } from "@/lib/constants";
import { defineModel } from "./_helpers";

const NotificationSchema = new Schema(
  {
    recipient: { type: Schema.Types.ObjectId, ref: "User", required: true },
    actor: { type: Schema.Types.ObjectId, ref: "User", default: null },
    type: { type: String, enum: NOTIFICATION_TYPES, default: "SYSTEM" },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    message: { type: String, trim: true, default: "", maxlength: 1000 },
    /** In-app path to open, e.g. /departments/<id>. */
    link: { type: String, default: "" },
    entityType: { type: String, default: "" },
    entityId: { type: Schema.Types.ObjectId, default: null },
    /** Preference bucket (see NOTIFICATION_PREFS); null = always delivered. */
    pref: { type: String, default: null },
    /** Set for reminders so the same reminder is never delivered twice. */
    dedupeKey: { type: String, default: null },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

NotificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ recipient: 1, type: 1, createdAt: -1 });
NotificationSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } });
// Keep notifications for 180 days.
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

export type NotificationDoc = InferSchemaType<typeof NotificationSchema> & { _id: Types.ObjectId };
export const Notification = defineModel("Notification", NotificationSchema);

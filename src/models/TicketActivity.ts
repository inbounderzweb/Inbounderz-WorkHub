import { Schema, type InferSchemaType, type Types } from "mongoose";
import { defineModel } from "./_helpers";

export const TICKET_ACTIVITY_ACTIONS = [
  "CREATED",
  "UPDATED",
  "REVIEW_STARTED",
  "DEPARTMENT_ASSIGNED",
  "ASSIGNED",
  "REASSIGNED",
  "STATUS_CHANGED",
  "COMMENTED",
  "INFO_REQUESTED",
  "INFO_PROVIDED",
  "ATTACHMENT_ADDED",
  "ATTACHMENT_REMOVED",
  "DELIVERABLE_UPLOADED",
  "RESOLVED",
  "CHANGES_REQUESTED",
  "CLOSED",
  "REJECTED",
  "REOPENED",
] as const;
export type TicketActivityAction = (typeof TICKET_ACTIVITY_ACTIONS)[number];

/** Append-only history of everything that happens to a ticket. */
const TicketActivitySchema = new Schema(
  {
    ticket: { type: Schema.Types.ObjectId, ref: "Ticket", required: true },
    actor: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, enum: TICKET_ACTIVITY_ACTIONS, required: true },
    message: { type: String, default: "", maxlength: 1000 },
    from: { type: Schema.Types.Mixed, default: null },
    to: { type: Schema.Types.Mixed, default: null },
    /** Structured details (ids of the people/departments/files involved). */
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

TicketActivitySchema.index({ ticket: 1, createdAt: 1 });
TicketActivitySchema.index({ actor: 1, createdAt: -1 });

export type TicketActivityDoc = InferSchemaType<typeof TicketActivitySchema> & { _id: Types.ObjectId };
export const TicketActivity = defineModel("TicketActivity", TicketActivitySchema);

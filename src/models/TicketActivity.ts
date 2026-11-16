import { Schema, type InferSchemaType, type Types } from "mongoose";
import { defineModel } from "./_helpers";

export const TICKET_ACTIVITY_ACTIONS = [
  "CREATED",
  "UPDATED",
  "SUBMITTED",
  "REVIEW_STARTED",
  "INFO_REQUESTED",
  "INFO_PROVIDED",
  "APPROVED",
  "REJECTED",
  "ASSIGNED",
  "REASSIGNED",
  "REVIEWER_ASSIGNED",
  "REVIEWER_CHANGED",
  "DATES_UPDATED",
  "STARTED",
  "ON_HOLD",
  "RESUMED",
  "WORK_SUBMITTED",
  "CHANGES_REQUESTED",
  "COMPLETED",
  "CANCELLED",
  "ESCALATED",
  "REORDERED",
  "PRIORITY_CHANGED",
  "COMMENTED",
  "ATTACHMENT_ADDED",
  "STATUS_CHANGED",
] as const;

/** Append-only history of everything that happens to a ticket. */
const TicketActivitySchema = new Schema(
  {
    ticket: { type: Schema.Types.ObjectId, ref: "Ticket", required: true },
    actor: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, enum: TICKET_ACTIVITY_ACTIONS, required: true },
    fromStatus: { type: String, default: null },
    toStatus: { type: String, default: null },
    /** Previous / new assignee names or other changed values. */
    from: { type: Schema.Types.Mixed, default: null },
    to: { type: Schema.Types.Mixed, default: null },
    /** Comment text, approval/rejection reason, clarification question, etc. */
    message: { type: String, default: "", maxlength: 3000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

TicketActivitySchema.index({ ticket: 1, createdAt: 1 });
TicketActivitySchema.index({ actor: 1, createdAt: -1 });

export type TicketActivityDoc = InferSchemaType<typeof TicketActivitySchema> & { _id: Types.ObjectId };
export const TicketActivity = defineModel("TicketActivity", TicketActivitySchema);

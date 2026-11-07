import { Schema, type InferSchemaType, type Types } from "mongoose";
import { defineModel } from "./_helpers";

export const TICKET_COMMENT_KINDS = [
  "COMMENT",
  "INFO_REQUEST",
  "INFO_RESPONSE",
  "RESOLUTION",
  "CHANGE_REQUEST",
  "CLOSURE",
  "REJECTION",
  "REOPEN",
  "ASSIGNMENT",
] as const;
export type TicketCommentKind = (typeof TICKET_COMMENT_KINDS)[number];

const TicketCommentSchema = new Schema(
  {
    ticket: { type: Schema.Types.ObjectId, ref: "Ticket", required: true },
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    /** Workflow messages (info requests, change requests…) are kept in the same thread. */
    kind: { type: String, enum: TICKET_COMMENT_KINDS, default: "COMMENT" },
  },
  { timestamps: true }
);

TicketCommentSchema.index({ ticket: 1, createdAt: 1 });

export type TicketCommentDoc = InferSchemaType<typeof TicketCommentSchema> & { _id: Types.ObjectId };
export const TicketComment = defineModel("TicketComment", TicketCommentSchema);

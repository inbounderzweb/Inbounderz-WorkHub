import { Schema, type InferSchemaType, type Types } from "mongoose";
import { CLIENT_HISTORY_ACTIONS } from "@/lib/constants";
import { defineModel, makeAppendOnly } from "./_helpers";

/**
 * Complete creation/modification history of a client. Append-only: one row per change with the
 * field-level before/after values. May contain GST and billing values, so reading it requires full
 * client access (see client.service getHistory).
 */
const ClientHistorySchema = new Schema(
  {
    client: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    actor: { type: Schema.Types.ObjectId, ref: "User", default: null },
    action: { type: String, enum: CLIENT_HISTORY_ACTIONS, required: true },
    /** { field: { from, to } } */
    changes: { type: Schema.Types.Mixed, default: null },
    /** Required for duplicate overrides; optional free text otherwise. */
    reason: { type: String, trim: true, default: "", maxlength: 1000 },
    summary: { type: String, default: "", maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ClientHistorySchema.index({ client: 1, createdAt: -1 });
makeAppendOnly(ClientHistorySchema, "Client history");

export type ClientHistoryDoc = InferSchemaType<typeof ClientHistorySchema> & { _id: Types.ObjectId };
export const ClientHistory = defineModel("ClientHistory", ClientHistorySchema);

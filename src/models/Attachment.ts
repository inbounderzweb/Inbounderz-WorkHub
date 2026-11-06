import { Schema, type InferSchemaType, type Types } from "mongoose";
import { defineModel } from "./_helpers";

export const ATTACHMENT_ENTITY_TYPES = ["Task", "TaskComment", "Project", "DailyUpdate"] as const;

const AttachmentSchema = new Schema(
  {
    fileName: { type: String, required: true, trim: true, maxlength: 255 },
    url: { type: String, required: true },
    storageKey: { type: String, default: "" },
    mimeType: { type: String, default: "application/octet-stream" },
    size: { type: Number, min: 0, default: 0 },
    entityType: { type: String, enum: ATTACHMENT_ENTITY_TYPES, required: true },
    entityId: { type: Schema.Types.ObjectId, refPath: "entityType", required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

AttachmentSchema.index({ entityType: 1, entityId: 1 });
AttachmentSchema.index({ uploadedBy: 1, createdAt: -1 });

export type AttachmentDoc = InferSchemaType<typeof AttachmentSchema> & { _id: Types.ObjectId };
export const Attachment = defineModel("Attachment", AttachmentSchema);

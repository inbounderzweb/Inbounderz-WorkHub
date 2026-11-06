import { Schema, type InferSchemaType, type Types } from "mongoose";
import { defineModel } from "./_helpers";

const TaskCommentSchema = new Schema(
  {
    task: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    mentions: [{ type: Schema.Types.ObjectId, ref: "User" }],
    attachments: [{ type: Schema.Types.ObjectId, ref: "Attachment" }],
    editedAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

TaskCommentSchema.index({ task: 1, createdAt: 1 });

export type TaskCommentDoc = InferSchemaType<typeof TaskCommentSchema> & { _id: Types.ObjectId };
export const TaskComment = defineModel("TaskComment", TaskCommentSchema);

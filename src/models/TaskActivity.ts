import { Schema, type InferSchemaType, type Types } from "mongoose";
import { defineModel } from "./_helpers";

export const TASK_ACTIVITY_ACTIONS = [
  "CREATED",
  "UPDATED",
  "STATUS_CHANGED",
  "ASSIGNED",
  "COLLABORATOR_ADDED",
  "COLLABORATOR_REMOVED",
  "COMMENTED",
  "ATTACHMENT_ADDED",
  "SUBMITTED_FOR_REVIEW",
  "APPROVED",
  "CHANGES_REQUESTED",
  "REOPENED",
  "BLOCKER_REPORTED",
  "BLOCKER_CLEARED",
  "CHECKLIST_UPDATED",
  "DEPENDENCY_ADDED",
  "DEPENDENCY_REMOVED",
  "SUBTASK_ADDED",
  "HOURS_LOGGED",
  "DELETED",
] as const;

const TaskActivitySchema = new Schema(
  {
    task: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    project: { type: Schema.Types.ObjectId, ref: "Project", default: null },
    actor: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, enum: TASK_ACTIVITY_ACTIONS, required: true },
    from: { type: Schema.Types.Mixed, default: null },
    to: { type: Schema.Types.Mixed, default: null },
    message: { type: String, default: "", maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

TaskActivitySchema.index({ task: 1, createdAt: -1 });
TaskActivitySchema.index({ project: 1, createdAt: -1 });
TaskActivitySchema.index({ actor: 1, createdAt: -1 });

export type TaskActivityDoc = InferSchemaType<typeof TaskActivitySchema> & { _id: Types.ObjectId };
export const TaskActivity = defineModel("TaskActivity", TaskActivitySchema);

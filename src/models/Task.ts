import { Schema, type InferSchemaType, type Types } from "mongoose";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/constants";
import { defineModel } from "./_helpers";

const TaskSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, default: "", maxlength: 10000 },
    project: { type: Schema.Types.ObjectId, ref: "Project", default: null },
    /** Set for subtasks. */
    parentTask: { type: Schema.Types.ObjectId, ref: "Task", default: null },
    milestone: { type: Schema.Types.ObjectId, ref: "Milestone", default: null },
    department: { type: Schema.Types.ObjectId, ref: "Department", default: null },

    status: { type: String, enum: TASK_STATUSES, default: "TODO" },
    priority: { type: String, enum: TASK_PRIORITIES, default: "MEDIUM" },

    /** Single accountable owner. */
    owner: { type: Schema.Types.ObjectId, ref: "User", default: null },
    collaborators: [{ type: Schema.Types.ObjectId, ref: "User" }],
    reviewer: { type: Schema.Types.ObjectId, ref: "User", default: null },

    startDate: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },

    estimatedHours: { type: Number, min: 0, default: null },
    loggedHours: { type: Number, min: 0, default: 0 },
    tags: [{ type: String, trim: true, maxlength: 40 }],
    order: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

TaskSchema.index({ project: 1, status: 1 });
TaskSchema.index({ owner: 1, status: 1, dueDate: 1 });
TaskSchema.index({ collaborators: 1, status: 1 });
TaskSchema.index({ department: 1, status: 1 });
TaskSchema.index({ parentTask: 1 });
TaskSchema.index({ status: 1, dueDate: 1 });
TaskSchema.index({ reviewer: 1, status: 1 });

export type TaskDoc = InferSchemaType<typeof TaskSchema> & { _id: Types.ObjectId };
export const Task = defineModel("Task", TaskSchema);

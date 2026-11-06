import { Schema, type InferSchemaType, type Types } from "mongoose";
import { APPROVAL_MODES, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/constants";
import { defineModel } from "./_helpers";

const ChecklistItemSchema = new Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 300 },
    done: { type: Boolean, default: false },
    doneBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    doneAt: { type: Date, default: null },
  },
  { _id: true }
);

const TaskSchema = new Schema(
  {
    /** Unique human-readable task number (TSK-00001). */
    taskNumber: { type: String, required: true, trim: true, uppercase: true },
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
    /** Who assigned the current owner. */
    assignedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    collaborators: [{ type: Schema.Types.ObjectId, ref: "User" }],
    /** Tasks (same project) that must be resolved before this one can progress. */
    dependencies: [{ type: Schema.Types.ObjectId, ref: "Task" }],
    checklist: { type: [ChecklistItemSchema], default: [] },

    startDate: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    completedAt: { type: Date, default: null },

    // Review / approval
    approvalRequired: { type: Boolean, default: true },
    approvalMode: { type: String, enum: APPROVAL_MODES, default: "DEPARTMENT" },
    submittedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },

    // Blocker reporting (independent of status)
    blocker: {
      isBlocked: { type: Boolean, default: false },
      reason: { type: String, trim: true, default: "", maxlength: 2000 },
      reportedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      reportedAt: { type: Date, default: null },
    },

    estimatedHours: { type: Number, min: 0, default: null },
    actualHours: { type: Number, min: 0, default: null },
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
TaskSchema.index({ taskNumber: 1 }, { unique: true });
TaskSchema.index({ dependencies: 1 });
TaskSchema.index({ milestone: 1 });

export type TaskDoc = InferSchemaType<typeof TaskSchema> & { _id: Types.ObjectId };
export const Task = defineModel("Task", TaskSchema);

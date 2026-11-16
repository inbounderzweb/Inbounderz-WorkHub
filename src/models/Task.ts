import { Schema, type InferSchemaType, type Types } from "mongoose";
import { APPROVAL_MODES, TASK_PRIORITIES, TASK_STATUSES, WORK_APPROVAL_STATUSES } from "@/lib/constants";
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

const TimeLogSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, required: true },
    seconds: { type: Number, min: 0, default: 0 },
    /** Optional note from the person who paused. */
    pauseReason: { type: String, trim: true, default: "", maxlength: 500 },
    /** PAUSED = paused manually; AUTO = stopped because the task left In Progress / was reassigned. */
    endKind: { type: String, enum: ["PAUSED", "AUTO"], default: "PAUSED" },
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
    /** Approval of a work request before work starts, separate from completion review. */
    workApproval: {
      status: { type: String, enum: WORK_APPROVAL_STATUSES, default: "NOT_REQUIRED" },
      requestedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      requestedAt: { type: Date, default: null },
      reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      reviewedAt: { type: Date, default: null },
      comment: { type: String, trim: true, default: "", maxlength: 2000 },
    },
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

    /** Work timer. `totalSeconds` = closed sessions; a running session adds (now - startedAt). */
    timer: {
      running: { type: Boolean, default: false },
      startedAt: { type: Date, default: null },
      by: { type: Schema.Types.ObjectId, ref: "User", default: null },
      totalSeconds: { type: Number, min: 0, default: 0 },
    },
    timeLog: { type: [TimeLogSchema], default: [] },

    estimatedHours: { type: Number, min: 0, default: null },
    actualHours: { type: Number, min: 0, default: null },
    tags: [{ type: String, trim: true, maxlength: 40 }],
    order: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

TaskSchema.index({ project: 1, status: 1 });
TaskSchema.index({ project: 1, "workApproval.status": 1, status: 1 });
TaskSchema.index({ owner: 1, status: 1, dueDate: 1 });
TaskSchema.index({ collaborators: 1, status: 1 });
TaskSchema.index({ department: 1, status: 1 });
TaskSchema.index({ parentTask: 1 });
TaskSchema.index({ status: 1, dueDate: 1 });
TaskSchema.index({ taskNumber: 1 }, { unique: true });
TaskSchema.index({ dependencies: 1 });
TaskSchema.index({ "timer.by": 1, "timer.running": 1 });
TaskSchema.index({ milestone: 1 });

export type TaskDoc = InferSchemaType<typeof TaskSchema> & { _id: Types.ObjectId };
export const Task = defineModel("Task", TaskSchema);

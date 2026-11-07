import { Schema, type InferSchemaType, type Types } from "mongoose";
import { DAILY_UPDATE_STATUSES } from "@/lib/constants";
import { defineModel } from "./_helpers";

const HistorySchema = new Schema(
  {
    action: { type: String, enum: ["SUBMITTED", "EDITED", "RESUBMITTED", "APPROVED", "CHANGES_REQUESTED"], required: true },
    by: { type: Schema.Types.ObjectId, ref: "User", required: true },
    at: { type: Date, required: true },
    comment: { type: String, trim: true, default: "", maxlength: 2000 },
  },
  { _id: false }
);

/**
 * One daily work report per employee, work day, project and (optional) task.
 * The unique index enforces "no duplicate report for the same work item and
 * date": a second submission is refused and the employee is pointed to the edit
 * workflow instead.
 */
const DailyUpdateSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    /** Snapshot of the author's department (who reviews it). */
    department: { type: Schema.Types.ObjectId, ref: "Department", default: null },
    /** Work day, stored at 00:00 UTC of the calendar day. */
    date: { type: Date, required: true },
    project: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    task: { type: Schema.Types.ObjectId, ref: "Task", default: null },

    workCompleted: { type: String, trim: true, required: true, maxlength: 5000 },
    pendingWork: { type: String, trim: true, default: "", maxlength: 3000 },
    blockers: { type: String, trim: true, default: "", maxlength: 2000 },
    hoursSpent: { type: Number, min: 0.25, max: 24, required: true },

    status: { type: String, enum: DAILY_UPDATE_STATUSES, default: "SUBMITTED" },
    revision: { type: Number, default: 1 },
    submittedAt: { type: Date, default: () => new Date() },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewComment: { type: String, trim: true, default: "", maxlength: 2000 },
    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true }
);

DailyUpdateSchema.index({ user: 1, date: 1, project: 1, task: 1 }, { unique: true, name: "one_report_per_work_item_per_day" });
DailyUpdateSchema.index({ user: 1, date: -1 });
DailyUpdateSchema.index({ department: 1, date: -1 });
DailyUpdateSchema.index({ project: 1, date: -1 });
DailyUpdateSchema.index({ status: 1, date: -1 });

export type DailyUpdateDoc = InferSchemaType<typeof DailyUpdateSchema> & { _id: Types.ObjectId };
export const DailyUpdate = defineModel("DailyUpdate", DailyUpdateSchema);

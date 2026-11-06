import { Schema, type InferSchemaType, type Types } from "mongoose";
import { TASK_STATUSES } from "@/lib/constants";
import { defineModel } from "./_helpers";

const DailyUpdateEntrySchema = new Schema(
  {
    task: { type: Schema.Types.ObjectId, ref: "Task", default: null },
    note: { type: String, trim: true, required: true, maxlength: 2000 },
    hoursSpent: { type: Number, min: 0, max: 24, default: 0 },
    statusAfter: { type: String, enum: TASK_STATUSES, default: null },
  },
  { _id: false }
);

const DailyUpdateSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    department: { type: Schema.Types.ObjectId, ref: "Department", default: null },
    /** Normalised to 00:00 UTC of the work day. */
    date: { type: Date, required: true },
    summary: { type: String, trim: true, required: true, maxlength: 5000 },
    entries: { type: [DailyUpdateEntrySchema], default: [] },
    blockers: { type: String, trim: true, default: "", maxlength: 2000 },
    plannedForTomorrow: { type: String, trim: true, default: "", maxlength: 2000 },
    totalHours: { type: Number, min: 0, max: 24, default: 0 },
  },
  { timestamps: true }
);

DailyUpdateSchema.index({ user: 1, date: -1 }, { unique: true });
DailyUpdateSchema.index({ department: 1, date: -1 });

export type DailyUpdateDoc = InferSchemaType<typeof DailyUpdateSchema> & { _id: Types.ObjectId };
export const DailyUpdate = defineModel("DailyUpdate", DailyUpdateSchema);

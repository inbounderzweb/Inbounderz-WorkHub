import { Schema } from "mongoose";
import { defineModel } from "./_helpers";

/** Single document (key "default") holding the Super Admin's workload thresholds and capacity rules. */
const WorkloadSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "default" },
    /** Available working hours per person = hoursPerDay x daysPerWeek (x 4 for the monthly view). */
    hoursPerDay: { type: Number, min: 1, max: 24, default: 8 },
    daysPerWeek: { type: Number, min: 1, max: 7, default: 5 },
    /** Utilization % at which a person becomes Moderate / High, and the level above which they are Overloaded. */
    moderateFrom: { type: Number, min: 1, max: 500, default: 40 },
    highFrom: { type: Number, min: 1, max: 500, default: 70 },
    overloadedAbove: { type: Number, min: 1, max: 500, default: 100 },
    /** Share of an item's hours that still counts against capacity while paused / waiting for review (0–1). */
    onHoldWeight: { type: Number, min: 0, max: 1, default: 0.5 },
    reviewWeight: { type: Number, min: 0, max: 1, default: 0 },
    /** Hours assumed for an active item that has no estimate. Utilization is then flagged as an estimate. */
    fallbackHours: { type: Number, min: 0, max: 200, default: 4 },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export const WorkloadSettings = defineModel("WorkloadSettings", WorkloadSettingsSchema);

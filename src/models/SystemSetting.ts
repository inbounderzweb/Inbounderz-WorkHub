import { Schema, type InferSchemaType, type Types } from "mongoose";
import { defineModel } from "./_helpers";

/**
 * Company-wide configuration (a single document with key "system").
 * Everything here is presentation or policy layered on top of the code-defined
 * workflows — nothing in it can invalidate existing records (see settings.service).
 */
const SystemSettingSchema = new Schema(
  {
    key: { type: String, required: true, default: "system" },
    company: {
      name: { type: String, trim: true, default: "Inbounderz", maxlength: 120 },
      legalName: { type: String, trim: true, default: "", maxlength: 200 },
      email: { type: String, trim: true, default: "", maxlength: 254 },
      phone: { type: String, trim: true, default: "", maxlength: 40 },
      website: { type: String, trim: true, default: "", maxlength: 300 },
      address: { type: String, trim: true, default: "", maxlength: 500 },
      /** IANA zone used for "today" (daily reports, reminders). */
      timezone: { type: String, trim: true, default: "Asia/Kolkata", maxlength: 60 },
    },
    /** Per task status: display label, and whether optional statuses are offered. */
    taskStatuses: { type: Schema.Types.Mixed, default: {} },
    /** Per priority: display label and default response time for tickets (days). */
    priorities: { type: Schema.Types.Mixed, default: {} },
    defaultPriority: { type: String, default: "MEDIUM" },
    /** Extra permissions granted / removed per role, limited to CONFIGURABLE_PERMISSIONS. */
    permissionOverrides: { type: Schema.Types.Mixed, default: {} },
    reminders: {
      taskDueSoonHours: { type: Number, min: 1, max: 168, default: 24 },
      projectDueSoonDays: { type: Number, min: 1, max: 30, default: 3 },
    },
    dailyUpdates: {
      /** How many days back a report may be submitted for. */
      backdateDays: { type: Number, min: 0, max: 31, default: 7 },
      maxHoursPerDay: { type: Number, min: 1, max: 24, default: 16 },
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, minimize: false }
);

SystemSettingSchema.index({ key: 1 }, { unique: true });

export type SystemSettingDoc = InferSchemaType<typeof SystemSettingSchema> & { _id: Types.ObjectId };
export const SystemSetting = defineModel("SystemSetting", SystemSettingSchema);

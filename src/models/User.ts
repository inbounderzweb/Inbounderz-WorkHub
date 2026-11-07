import { Schema, type InferSchemaType, type Types } from "mongoose";
import { USER_STATUSES } from "@/lib/constants";
import { defineModel } from "./_helpers";

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Invalid email address"],
    },
    phone: { type: String, trim: true, default: "", maxlength: 30 },
    employeeId: { type: String, required: true, trim: true, uppercase: true, maxlength: 30 },
    designation: { type: String, trim: true, default: "", maxlength: 120 },
    passwordHash: { type: String, required: true, select: false },

    role: { type: Schema.Types.ObjectId, ref: "Role", required: true },
    /** Primary department. An employee belongs to exactly one primary department. */
    department: { type: Schema.Types.ObjectId, ref: "Department", default: null },
    reportingManager: { type: Schema.Types.ObjectId, ref: "User", default: null },
    joiningDate: { type: Date, default: null },
    status: { type: String, enum: USER_STATUSES, default: "ACTIVE" },
    avatarUrl: { type: String, default: "" },
    /** In-app notification categories this user has switched off (NOTIFICATION_PREFS keys). */
    notificationPrefs: {
      muted: { type: [String], default: [] },
    },

    // Security
    lastLoginAt: { type: Date, default: null },
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, default: null, select: false },
    /** Incremented on password change/reset to revoke existing sessions. */
    sessionVersion: { type: Number, default: 0 },
    passwordResetTokenHash: { type: String, default: null, select: false },
    passwordResetExpires: { type: Date, default: null, select: false },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ employeeId: 1 }, { unique: true });
UserSchema.index({ department: 1, status: 1 });
UserSchema.index({ role: 1, status: 1 });
UserSchema.index({ reportingManager: 1 });
UserSchema.index({ name: 1 });
UserSchema.index({ createdAt: -1 });

export type UserDoc = InferSchemaType<typeof UserSchema> & { _id: Types.ObjectId };
export const User = defineModel("User", UserSchema);

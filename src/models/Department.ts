import { Schema, type InferSchemaType, type Types } from "mongoose";
import { DEPARTMENT_STATUSES } from "@/lib/constants";
import { defineModel } from "./_helpers";

const DepartmentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    /** Short unique code, e.g. "DEV", "SEO". */
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 12 },
    description: { type: String, trim: true, default: "", maxlength: 1000 },
    head: { type: Schema.Types.ObjectId, ref: "User", default: null },
    teamLeaders: [{ type: Schema.Types.ObjectId, ref: "User" }],
    status: { type: String, enum: DEPARTMENT_STATUSES, default: "ACTIVE" },
    color: { type: String, default: "#16a34a" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// Case-insensitive uniqueness for names.
DepartmentSchema.index({ name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
DepartmentSchema.index({ code: 1 }, { unique: true });
DepartmentSchema.index({ head: 1 });
DepartmentSchema.index({ teamLeaders: 1 });

export type DepartmentDoc = InferSchemaType<typeof DepartmentSchema> & { _id: Types.ObjectId };
export const Department = defineModel("Department", DepartmentSchema);

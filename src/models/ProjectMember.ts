import { Schema, type InferSchemaType, type Types } from "mongoose";
import { PROJECT_MEMBER_ROLES } from "@/lib/constants";
import { defineModel } from "./_helpers";

/** Join collection: which employees work on which project, and in what capacity. */
const ProjectMemberSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    /** Department the member represents on this project. */
    department: { type: Schema.Types.ObjectId, ref: "Department", default: null },
    projectRole: { type: String, enum: PROJECT_MEMBER_ROLES, default: "MEMBER" },
    allocationPercent: { type: Number, min: 0, max: 100, default: 100 },
    isActive: { type: Boolean, default: true },
    joinedAt: { type: Date, default: () => new Date() },
    leftAt: { type: Date, default: null },
    addedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

ProjectMemberSchema.index({ project: 1, user: 1 }, { unique: true });
ProjectMemberSchema.index({ user: 1, isActive: 1 });
ProjectMemberSchema.index({ project: 1, department: 1 });

export type ProjectMemberDoc = InferSchemaType<typeof ProjectMemberSchema> & { _id: Types.ObjectId };
export const ProjectMember = defineModel("ProjectMember", ProjectMemberSchema);

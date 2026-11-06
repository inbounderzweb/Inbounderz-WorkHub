import { Schema, type InferSchemaType, type Types } from "mongoose";
import { MILESTONE_STATUSES } from "@/lib/constants";
import { defineModel } from "./_helpers";

const MilestoneSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, trim: true, default: "", maxlength: 2000 },
    dueDate: { type: Date, default: null },
    status: { type: String, enum: MILESTONE_STATUSES, default: "PENDING" },
    order: { type: Number, default: 0 },
    completedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

MilestoneSchema.index({ project: 1, dueDate: 1 });

export type MilestoneDoc = InferSchemaType<typeof MilestoneSchema> & { _id: Types.ObjectId };
export const Milestone = defineModel("Milestone", MilestoneSchema);

import { Schema, type InferSchemaType, type Types } from "mongoose";
import { PM_ASSIGNMENT_STATUSES } from "@/lib/constants";
import { defineModel } from "./_helpers";

/**
 * One nomination of a Project Manager for a project. Rejections and re-nominations add rows, so the
 * assignment history is the collection itself. `isCurrent` marks the single live row per project;
 * its partial unique index is what makes concurrent nominate/accept calls safe.
 */
const PMAssignmentSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    client: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    status: { type: String, enum: PM_ASSIGNMENT_STATUSES, default: "DRAFT" },
    isCurrent: { type: Boolean, default: true },
    /** 1 for the first nomination, then 2, 3 ... */
    sequence: { type: Number, default: 1 },
    primaryPm: { type: Schema.Types.ObjectId, ref: "User", default: null },
    supportingPms: [{ type: Schema.Types.ObjectId, ref: "User" }],
    coordinator: { type: Schema.Types.ObjectId, ref: "User", default: null },
    handoverNotes: { type: String, trim: true, default: "", maxlength: 5000 },
    proposedHandoverDate: { type: Date, default: null },
    nominatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    submittedAt: { type: Date, default: null },
    respondedAt: { type: Date, default: null },
    respondedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    rejectionReason: { type: String, trim: true, default: "", maxlength: 2000 },
    events: [
      {
        _id: false,
        at: { type: Date, default: () => new Date() },
        actor: { type: Schema.Types.ObjectId, ref: "User", default: null },
        action: { type: String, required: true },
        note: { type: String, default: "", maxlength: 2000 },
      },
    ],
  },
  { timestamps: true }
);

PMAssignmentSchema.index({ project: 1 }, { unique: true, partialFilterExpression: { isCurrent: true } });
PMAssignmentSchema.index({ project: 1, sequence: 1 });
PMAssignmentSchema.index({ primaryPm: 1, status: 1 });
PMAssignmentSchema.index({ supportingPms: 1, status: 1 });
PMAssignmentSchema.index({ coordinator: 1, status: 1 });

export type PMAssignmentDoc = InferSchemaType<typeof PMAssignmentSchema> & { _id: Types.ObjectId };
export const PMAssignment = defineModel("PMAssignment", PMAssignmentSchema);

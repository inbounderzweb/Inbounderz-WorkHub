import { Schema, type InferSchemaType, type Types } from "mongoose";
import { APPROVAL_MODES, CURRENCIES, DEFAULT_CURRENCY, PROJECT_STATUSES, TASK_PRIORITIES } from "@/lib/constants";
import { defineModel } from "./_helpers";

/**
 * Teams are NOT embedded here — see ProjectMember. A project only references the
 * departments it spans and its accountable manager.
 */
const ProjectSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    /** Project ID, generated automatically (PRJ-0001). */
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    description: { type: String, trim: true, default: "", maxlength: 5000 },
    /** Legacy free-text client name. Kept for history; `clientRef` is the source of truth once set. */
    client: { type: String, trim: true, default: "", maxlength: 150 },
    /** The Client record. One client can have many projects. Null for projects not yet linked. */
    clientRef: { type: Schema.Types.ObjectId, ref: "Client", default: null },
    status: { type: String, enum: PROJECT_STATUSES, default: "PLANNING" },
    priority: { type: String, enum: TASK_PRIORITIES, default: "MEDIUM" },
    departments: [{ type: Schema.Types.ObjectId, ref: "Department" }],
    /**
     * The accountable PM. Null only while a project is in the handover states (DRAFT, HANDOVER_PENDING,
     * PM_REJECTED): ownership is set when the nominated PM accepts, never by nomination alone.
     */
    manager: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** Currency of every amount on this project and its services. Amounts of different currencies are never mixed. */
    currency: { type: String, enum: CURRENCIES, default: DEFAULT_CURRENCY },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    budget: { type: Number, min: 0, default: null },
    notes: { type: String, trim: true, default: "", maxlength: 10000 },
    /** Default approver for tasks in this project (each task can override). */
    approvalMode: { type: String, enum: APPROVAL_MODES, default: "DEPARTMENT" },
    /** Cached completion percentage (0–100), recalculated when tasks change. */
    progress: { type: Number, default: 0, min: 0, max: 100 },
    /** Archived projects are read-only and hidden from default lists. */
    isArchived: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
    archivedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

ProjectSchema.index({ code: 1 }, { unique: true });
ProjectSchema.index({ status: 1, endDate: 1 });
ProjectSchema.index({ isArchived: 1, createdAt: -1 });
ProjectSchema.index({ departments: 1, status: 1 });
ProjectSchema.index({ manager: 1, status: 1 });
ProjectSchema.index({ name: 1 });
ProjectSchema.index({ clientRef: 1, createdAt: -1 });
ProjectSchema.index({ createdBy: 1, status: 1 });

export type ProjectDoc = InferSchemaType<typeof ProjectSchema> & { _id: Types.ObjectId };
export const Project = defineModel("Project", ProjectSchema);

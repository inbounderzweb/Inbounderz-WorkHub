import { Schema, type InferSchemaType, type Types } from "mongoose";
import { CURRENCIES, DEFAULT_CURRENCY, PROJECT_SERVICE_STATUSES, SERVICE_TYPES } from "@/lib/constants";
import { defineModel } from "./_helpers";

const DeliverableSchema = new Schema(
  {
    type: { type: String, required: true, trim: true, maxlength: 80 },
    quantity: { type: Number, required: true, min: 1 },
    specifications: { type: String, trim: true, default: "", maxlength: 1000 },
    /** Same progress model as ticket deliverables: 0 <= verified <= completed <= quantity. */
    completedQuantity: { type: Number, default: 0, min: 0 },
    verifiedQuantity: { type: Number, default: 0, min: 0 },
  },
  { _id: true }
);

/**
 * A service the client confirmed for a project: the delivery-side counterpart of a
 * ClientServiceRequirement. `requirement` keeps the link and `requirementSnapshot` freezes what Sales
 * had collected at conversion time, so later edits to the requirement never rewrite the contract.
 */
const ProjectServiceSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    client: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    requirement: { type: Schema.Types.ObjectId, ref: "ClientServiceRequirement", required: true },
    serviceType: { type: String, enum: SERVICE_TYPES, required: true },
    confirmedScope: { type: String, trim: true, required: true, maxlength: 5000 },
    deliverables: { type: [DeliverableSchema], default: [] },
    currency: { type: String, enum: CURRENCIES, default: DEFAULT_CURRENCY },
    approvedBudget: { type: Number, min: 0, default: null },
    agencyFee: { type: Number, min: 0, default: null },
    adSpend: { type: Number, min: 0, default: null },
    estimatedHours: { type: Number, min: 0, default: null },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    status: { type: String, enum: PROJECT_SERVICE_STATUSES, default: "PLANNED" },
    requirementSnapshot: { type: Schema.Types.Mixed, default: null },
    /**
     * True while this service counts against its requirement. A requirement can back only one live
     * project service; cancelling the project releases it.
     */
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

ProjectServiceSchema.index({ project: 1, createdAt: 1 });
ProjectServiceSchema.index({ client: 1 });
/** Atomic guard against two handovers converting the same requirement at once. */
ProjectServiceSchema.index({ requirement: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

export type ProjectServiceDoc = InferSchemaType<typeof ProjectServiceSchema> & { _id: Types.ObjectId };
export const ProjectService = defineModel("ProjectService", ProjectServiceSchema);

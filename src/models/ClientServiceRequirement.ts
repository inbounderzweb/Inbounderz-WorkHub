import { Schema, type InferSchemaType, type Types } from "mongoose";
import { CURRENCIES, DEFAULT_CURRENCY, REQUIREMENT_STATUSES, SERVICE_TYPES } from "@/lib/constants";
import { defineModel } from "./_helpers";

/**
 * Pre-sales information: what a client is interested in and what Sales proposed. It is NOT delivery
 * scope. Converting it into a project creates a ProjectService that points back here; the
 * requirement itself is never consumed or altered by that.
 *
 * `config` is validated per service type (lib/clients/service-requirements.ts) before it is stored.
 * The three amounts are deliberately separate: proposed budget (our fee for the service), advertising
 * spend (the client's money that goes to the ad platforms) and the agency/management fee.
 */
const ClientServiceRequirementSchema = new Schema(
  {
    client: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    serviceType: { type: String, enum: SERVICE_TYPES, required: true },
    status: { type: String, enum: REQUIREMENT_STATUSES, default: "INTERESTED" },
    config: { type: Schema.Types.Mixed, default: () => ({}) },
    /** One-line description derived from `config` on every write, for lists and notifications. */
    summary: { type: String, default: "", maxlength: 400 },
    currency: { type: String, enum: CURRENCIES, default: DEFAULT_CURRENCY },
    proposedBudget: { type: Number, min: 0, default: null },
    adSpend: { type: Number, min: 0, default: null },
    agencyFee: { type: Number, min: 0, default: null },
    /** Removed requirements are kept for history; they disappear from every list. */
    isActive: { type: Boolean, default: true },
    removedAt: { type: Date, default: null },
    removedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

ClientServiceRequirementSchema.index({ client: 1, isActive: 1, createdAt: 1 });
ClientServiceRequirementSchema.index({ client: 1, serviceType: 1 });
ClientServiceRequirementSchema.index({ status: 1, isActive: 1 });

export type ClientServiceRequirementDoc = InferSchemaType<typeof ClientServiceRequirementSchema> & { _id: Types.ObjectId };
export const ClientServiceRequirement = defineModel("ClientServiceRequirement", ClientServiceRequirementSchema);

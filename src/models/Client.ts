import { Schema, type InferSchemaType, type Types } from "mongoose";
import { CLIENT_STATUSES, CURRENCIES, DEFAULT_CURRENCY } from "@/lib/constants";
import { defineModel } from "./_helpers";

const AddressSchema = new Schema(
  {
    line1: { type: String, trim: true, default: "", maxlength: 200 },
    line2: { type: String, trim: true, default: "", maxlength: 200 },
    city: { type: String, trim: true, default: "", maxlength: 100 },
    state: { type: String, trim: true, default: "", maxlength: 100 },
    postalCode: { type: String, trim: true, default: "", maxlength: 20 },
    country: { type: String, trim: true, default: "India", maxlength: 100 },
  },
  { _id: false }
);

/**
 * A client is a company the agency sells to. Projects reference it (`Project.clientRef`); a client
 * never embeds its projects. One client, many projects.
 *
 * The `norm*`, `looseName`, `nameKey` and `dedupeKey` fields are derived by the service on every
 * write (lib/clients/normalize.ts) and only exist to make duplicate detection indexed and atomic.
 */
const ClientSchema = new Schema(
  {
    /** Generated automatically (CLT-00001). */
    clientCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    contactPerson: { type: String, trim: true, default: "", maxlength: 120 },
    email: { type: String, trim: true, lowercase: true, default: "", maxlength: 254 },
    phone: { type: String, trim: true, default: "", maxlength: 30 },
    /** The main contact person's own role and details. `email`/`phone` below are the business's (and drive duplicate detection). */
    contactDesignation: { type: String, trim: true, default: "", maxlength: 120 },
    contactEmail: { type: String, trim: true, lowercase: true, default: "", maxlength: 254 },
    contactPhone: { type: String, trim: true, default: "", maxlength: 30 },
    /** A second business phone number. */
    alternatePhone: { type: String, trim: true, default: "", maxlength: 30 },
    alternateContact: {
      name: { type: String, trim: true, default: "", maxlength: 120 },
      email: { type: String, trim: true, lowercase: true, default: "", maxlength: 254 },
      phone: { type: String, trim: true, default: "", maxlength: 30 },
    },
    businessCategory: { type: String, trim: true, default: "", maxlength: 80 },
    website: { type: String, trim: true, default: "", maxlength: 300 },
    businessAddress: { type: AddressSchema, default: () => ({}) },
    /** When true the billing address is the business address and `billingAddress` is ignored. */
    billingSameAsBusiness: { type: Boolean, default: true },
    billingAddress: { type: AddressSchema, default: () => ({}) },
    /** Optional. Format and checksum validated only; not proof of an active registration. */
    gst: {
      gstin: { type: String, trim: true, uppercase: true, default: "", maxlength: 15 },
      legalName: { type: String, trim: true, default: "", maxlength: 200 },
      stateCode: { type: String, default: "", maxlength: 2 },
    },
    defaultCurrency: { type: String, enum: CURRENCIES, default: DEFAULT_CURRENCY },
    notes: { type: String, trim: true, default: "", maxlength: 5000 },
    /** Accountable Sales Executive. Null for clients imported from legacy projects until an Admin assigns one. */
    salesOwner: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** Project Manager asked to review and approve this client's onboarding. Nominated by Sales when the client is created. */
    projectManager: { type: Schema.Types.ObjectId, ref: "User", default: null },
    status: { type: String, enum: CLIENT_STATUSES, default: "PROSPECT" },

    // Derived (never set by clients of the API)
    normName: { type: String, default: "" },
    looseName: { type: String, default: "" },
    nameKey: { type: String, default: "" },
    normEmail: { type: String, default: "" },
    normPhone: { type: String, default: "" },
    /** `email|phone`. Unique while set; unset for archived clients and Admin-approved duplicates. */
    dedupeKey: { type: String },

    /** Set only on clients created by the legacy-project migration. Used to find and revert them. */
    migration: {
      source: { type: String, default: null },
      migratedAt: { type: Date, default: null },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

ClientSchema.index({ clientCode: 1 }, { unique: true });
ClientSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } });
ClientSchema.index({ normEmail: 1 });
ClientSchema.index({ normPhone: 1 });
ClientSchema.index({ normName: 1 });
ClientSchema.index({ looseName: 1 });
ClientSchema.index({ nameKey: 1 });
ClientSchema.index({ salesOwner: 1, status: 1 });
ClientSchema.index({ status: 1, updatedAt: -1 });
ClientSchema.index({ "migration.source": 1 });
ClientSchema.index({ name: "text", contactPerson: "text", email: "text", clientCode: "text" });

export type ClientDoc = InferSchemaType<typeof ClientSchema> & { _id: Types.ObjectId };
export const Client = defineModel("Client", ClientSchema);

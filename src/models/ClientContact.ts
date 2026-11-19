import { Schema, type InferSchemaType, type Types } from "mongoose";
import { defineModel } from "./_helpers";

/** Additional people at a client (the main contact lives on the Client itself). */
const ClientContactSchema = new Schema(
  {
    client: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    designation: { type: String, trim: true, default: "", maxlength: 120 },
    email: { type: String, trim: true, lowercase: true, default: "", maxlength: 254 },
    phone: { type: String, trim: true, default: "", maxlength: 30 },
    notes: { type: String, trim: true, default: "", maxlength: 1000 },
    /** Removed contacts stay for history; they are just hidden. */
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

ClientContactSchema.index({ client: 1, isActive: 1, createdAt: 1 });

export type ClientContactDoc = InferSchemaType<typeof ClientContactSchema> & { _id: Types.ObjectId };
export const ClientContact = defineModel("ClientContact", ClientContactSchema);

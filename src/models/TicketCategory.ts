import { Schema, type InferSchemaType, type Types } from "mongoose";
import { defineModel } from "./_helpers";

/** Configurable ticket categories (managed by Super Admins under Settings). */
const TicketCategorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, default: "", maxlength: 300 },
    /** Suggested target department, pre-selected when raising a ticket. */
    defaultDepartment: { type: Schema.Types.ObjectId, ref: "Department", default: null },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

TicketCategorySchema.index({ name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
TicketCategorySchema.index({ isActive: 1, order: 1 });

export type TicketCategoryDoc = InferSchemaType<typeof TicketCategorySchema> & { _id: Types.ObjectId };
export const TicketCategory = defineModel("TicketCategory", TicketCategorySchema);

import { Schema, type InferSchemaType, type Types } from "mongoose";
import { defineModel } from "./_helpers";

const AuditLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** Dotted action name, e.g. "employee.create", "department.assign_head". */
    action: { type: String, required: true, trim: true },
    entityType: { type: String, required: true, trim: true },
    entityId: { type: Schema.Types.ObjectId, default: null },
    summary: { type: String, default: "", maxlength: 500 },
    /** Field-level diff: { field: { from, to } } */
    changes: { type: Schema.Types.Mixed, default: null },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
AuditLogSchema.index({ actor: 1, createdAt: -1 });

export type AuditLogDoc = InferSchemaType<typeof AuditLogSchema> & { _id: Types.ObjectId };
export const AuditLog = defineModel("AuditLog", AuditLogSchema);

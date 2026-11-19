import { Schema, type InferSchemaType, type Types } from "mongoose";
import { ROLE_KEYS } from "@/lib/constants";
import { defineModel } from "./_helpers";

const RoleSchema = new Schema(
  {
    key: { type: String, enum: ROLE_KEYS, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    /** Higher level = more authority. Used to prevent privilege escalation. */
    level: { type: Number, required: true, min: 0 },
    /** Effective permissions: the code defaults with `granted` added and `revoked` removed. */
    permissions: { type: [String], default: [] },
    /** Super Admin edits relative to the code defaults, so a new default shipped in code still reaches every role. */
    granted: { type: [String], default: [] },
    revoked: { type: [String], default: [] },
    isSystem: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export type RoleDoc = InferSchemaType<typeof RoleSchema> & { _id: Types.ObjectId };
export const Role = defineModel("Role", RoleSchema);

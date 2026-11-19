import { Schema, type InferSchemaType, type Types } from "mongoose";
import { DUPLICATE_REVIEW_SOURCES, DUPLICATE_REVIEW_STATUSES } from "@/lib/constants";
import { defineModel } from "./_helpers";

/**
 * A pair of clients that might be the same company. Records are never merged automatically: an
 * Admin looks at the pair and decides. `pairKey` makes creation idempotent.
 */
const DuplicateReviewSchema = new Schema(
  {
    clientA: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    clientB: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    pairKey: { type: String, required: true },
    source: { type: String, enum: DUPLICATE_REVIEW_SOURCES, required: true },
    score: { type: Number, min: 0, max: 1, default: 0 },
    reasons: [{ type: String, maxlength: 200 }],
    status: { type: String, enum: DUPLICATE_REVIEW_STATUSES, default: "OPEN" },
    resolutionNote: { type: String, trim: true, default: "", maxlength: 1000 },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

DuplicateReviewSchema.index({ pairKey: 1 }, { unique: true });
DuplicateReviewSchema.index({ status: 1, createdAt: -1 });
DuplicateReviewSchema.index({ clientA: 1 });
DuplicateReviewSchema.index({ clientB: 1 });

export type DuplicateReviewDoc = InferSchemaType<typeof DuplicateReviewSchema> & { _id: Types.ObjectId };
export const DuplicateReview = defineModel("DuplicateReview", DuplicateReviewSchema);

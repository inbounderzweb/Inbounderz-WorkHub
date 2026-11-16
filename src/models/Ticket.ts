import { Schema, type InferSchemaType, type Types } from "mongoose";
import { REVIEW_STATUSES, TASK_PRIORITIES, TICKET_STATUSES } from "@/lib/constants";
import { defineModel } from "./_helpers";

const TimeLogSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, required: true },
    seconds: { type: Number, min: 0, required: true },
    pauseReason: { type: String, trim: true, default: "", maxlength: 500 },
    endKind: { type: String, enum: ["PAUSED", "AUTO"], default: "PAUSED" },
  },
  { _id: true }
);

const ReviewCommentSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    decision: { type: String, enum: ["APPROVED", "CHANGES_REQUESTED"], required: true },
    comment: { type: String, trim: true, default: "", maxlength: 2000 },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: true }
);

/** One entry per reviewer assignment / reassignment. Append-only. */
const ReviewHistorySchema = new Schema(
  {
    previousReviewer: { type: Schema.Types.ObjectId, ref: "User", default: null },
    newReviewer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    changedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, trim: true, default: "", maxlength: 2000 },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: true }
);

const TicketSchema = new Schema(
  {
    /** Unique human-readable number (TKT-00001). */
    ticketNumber: { type: String, required: true, trim: true, uppercase: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, default: "", maxlength: 10000 },
    category: { type: String, trim: true, default: "Other", maxlength: 60 },
    priority: { type: String, enum: TASK_PRIORITIES, default: "MEDIUM" },
    status: { type: String, enum: TICKET_STATUSES, default: "PENDING_APPROVAL" },

    requestingDepartment: { type: Schema.Types.ObjectId, ref: "Department", default: null },
    targetDepartment: { type: Schema.Types.ObjectId, ref: "Department", required: true },
    /** Other departments that also work on / support this ticket (e.g. Graphic Design). */
    additionalDepartments: [{ type: Schema.Types.ObjectId, ref: "Department" }],
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    /** Selected reviewer. Null keeps the department's default Project Manager routing. */
    projectManager: { type: Schema.Types.ObjectId, ref: "User", default: null },

    /** Hint for the Project Manager only. Never assigns or notifies anyone. */
    suggestedEmployee: { type: Schema.Types.ObjectId, ref: "User", default: null },
    referenceLinks: [{ type: String, trim: true, maxlength: 500 }],
    dueDate: { type: Date, default: null },

    // Triage (Project Manager)
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    decisionReason: { type: String, trim: true, default: "", maxlength: 2000 },
    clarificationRequest: { type: String, trim: true, default: "", maxlength: 2000 },

    // Assignment
    assignee: { type: Schema.Types.ObjectId, ref: "User", default: null },
    assignedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    assignedAt: { type: Date, default: null },
    estimatedHours: { type: Number, min: 0, default: null },
    expectedCompletion: { type: Date, default: null },

    /**
     * Manager-defined order inside the assignee's queue (1 = work on this first). Independent of
     * `priority`: changing one never changes the other. `queueId` is the assignee whose queue the rank belongs to.
     */
    queueId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    priorityRank: { type: Number, min: 1, default: null },
    reorderedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reorderedAt: { type: Date, default: null },

    /**
     * Independent reviewer of the finished work, chosen by the Project Manager. `assignee` is the executor
     * ("assignedTo"). Null = legacy ticket: the requester reviews the deliverable.
     */
    assignedReviewer: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewStatus: { type: String, enum: REVIEW_STATUSES, default: "NONE" },
    /** Who decided the latest review (`reviewedBy` above is the triaging Project Manager). */
    reviewDecidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewDecidedAt: { type: Date, default: null },
    reviewComments: { type: [ReviewCommentSchema], default: [] },
    reviewHistory: { type: [ReviewHistorySchema], default: [] },

    /** Work timer. `totalSeconds` = closed sessions; a running session adds (now - startedAt). */
    timer: {
      running: { type: Boolean, default: false },
      startedAt: { type: Date, default: null },
      by: { type: Schema.Types.ObjectId, ref: "User", default: null },
      totalSeconds: { type: Number, min: 0, default: 0 },
    },
    timeLog: { type: [TimeLogSchema], default: [] },

    // Delivery
    startedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    submissionNote: { type: String, trim: true, default: "", maxlength: 2000 },
    completedAt: { type: Date, default: null },

    // Deadline reminders already sent
    dueSoonNotified: { type: Boolean, default: false },
    overdueNotified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

TicketSchema.index({ ticketNumber: 1 }, { unique: true });
TicketSchema.index({ createdBy: 1, status: 1 });
TicketSchema.index({ assignee: 1, status: 1 });
TicketSchema.index({ queueId: 1, priorityRank: 1 });
TicketSchema.index({ assignee: 1, assignedAt: 1 });
TicketSchema.index({ targetDepartment: 1, status: 1 });
TicketSchema.index({ additionalDepartments: 1, status: 1 });
TicketSchema.index({ assignedReviewer: 1, reviewStatus: 1 });
TicketSchema.index({ reviewStatus: 1, submittedAt: 1 });
TicketSchema.index({ projectManager: 1, status: 1 });
TicketSchema.index({ requestingDepartment: 1, status: 1 });
TicketSchema.index({ status: 1, dueDate: 1 });

export type TicketDoc = InferSchemaType<typeof TicketSchema> & { _id: Types.ObjectId };
export const Ticket = defineModel("Ticket", TicketSchema);

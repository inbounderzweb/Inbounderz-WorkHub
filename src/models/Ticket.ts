import { Schema, type InferSchemaType, type Types } from "mongoose";
import { TASK_PRIORITIES, TICKET_STATUSES } from "@/lib/constants";
import { defineModel } from "./_helpers";

/** One row per assignment. Reassignment ends the current row and appends a new one. */
const AssignmentSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: "User", required: true },
    department: { type: Schema.Types.ObjectId, ref: "Department", required: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    assignedAt: { type: Date, required: true },
    note: { type: String, trim: true, default: "", maxlength: 2000 },
    endedAt: { type: Date, default: null },
    endReason: { type: String, enum: ["REASSIGNED", "REJECTED", null], default: null },
  },
  { _id: true }
);

/** One row per "Submit as resolved". The requester's decision is recorded on it. */
const ResolutionSchema = new Schema(
  {
    round: { type: Number, required: true },
    note: { type: String, trim: true, default: "", maxlength: 5000 },
    deliverables: [{ type: Schema.Types.ObjectId, ref: "Attachment" }],
    submittedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    submittedAt: { type: Date, required: true },
    outcome: { type: String, enum: ["PENDING", "ACCEPTED", "CHANGES_REQUESTED"], default: "PENDING" },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    feedback: { type: String, trim: true, default: "", maxlength: 5000 },
  },
  { _id: true }
);

const TicketSchema = new Schema(
  {
    /** Unique human-readable number (TKT-0001). */
    ticketNumber: { type: String, required: true, trim: true, uppercase: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true, maxlength: 10000 },

    requester: { type: Schema.Types.ObjectId, ref: "User", required: true },
    /** Snapshot of the requester's primary department when the ticket was raised. */
    requestingDepartment: { type: Schema.Types.ObjectId, ref: "Department", required: true },
    targetDepartment: { type: Schema.Types.ObjectId, ref: "Department", required: true },
    project: { type: Schema.Types.ObjectId, ref: "Project", default: null },
    category: { type: Schema.Types.ObjectId, ref: "TicketCategory", required: true },
    /** Snapshot so renaming/deactivating a category never rewrites history. */
    categoryName: { type: String, required: true, trim: true, maxlength: 80 },
    priority: { type: String, enum: TASK_PRIORITIES, default: "MEDIUM" },
    /** Required completion date (stored at 23:59:59Z of the calendar day). */
    dueDate: { type: Date, required: true },
    referenceLinks: [{ type: String, trim: true, maxlength: 2000 }],

    status: { type: String, enum: TICKET_STATUSES, default: "NEW" },

    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },

    /** Current assignee (mirrors the open row in `assignments`). */
    assignee: { type: Schema.Types.ObjectId, ref: "User", default: null },
    assignedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    assignedAt: { type: Date, default: null },
    assignments: { type: [AssignmentSchema], default: [] },
    /** The internal work item in the assignee's My Tasks (Task.sourceType = internal_ticket). */
    linkedTask: { type: Schema.Types.ObjectId, ref: "Task", default: null },

    /** Open request for more information (status WAITING_FOR_INFO). */
    infoRequest: {
      requestedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      requestedAt: { type: Date, default: null },
      message: { type: String, trim: true, default: "", maxlength: 5000 },
      resumeStatus: { type: String, enum: [...TICKET_STATUSES, null], default: null },
    },

    resolutions: { type: [ResolutionSchema], default: [] },
    startedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },

    closure: {
      closedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      closedAt: { type: Date, default: null },
      note: { type: String, trim: true, default: "", maxlength: 5000 },
      /** True when a manager confirmed completion on the requester's behalf. */
      byManager: { type: Boolean, default: false },
    },
    rejection: {
      rejectedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      rejectedAt: { type: Date, default: null },
      reason: { type: String, trim: true, default: "", maxlength: 5000 },
    },
    reopenCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

TicketSchema.index({ ticketNumber: 1 }, { unique: true });
TicketSchema.index({ requester: 1, createdAt: -1 });
TicketSchema.index({ status: 1, createdAt: -1 });
TicketSchema.index({ targetDepartment: 1, status: 1 });
TicketSchema.index({ requestingDepartment: 1, status: 1 });
TicketSchema.index({ assignee: 1, status: 1 });
TicketSchema.index({ project: 1, status: 1 });
TicketSchema.index({ dueDate: 1, status: 1 });
TicketSchema.index({ "assignments.employee": 1 });

export type TicketDoc = InferSchemaType<typeof TicketSchema> & { _id: Types.ObjectId };
export const Ticket = defineModel("Ticket", TicketSchema);

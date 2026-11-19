import { z } from "zod";
import { CURRENCIES, DEFAULT_CURRENCY, MIN_REJECTION_REASON, REQUIREMENT_STATUSES, TASK_PRIORITIES } from "@/lib/constants";
import { requirementInputSchema } from "@/lib/clients/service-requirements";
import { objectId, optionalDateString } from "./common";

export const syncRequirementsSchema = z.object({ requirements: z.array(requirementInputSchema).max(30), expectedUpdatedAt: z.string().datetime().optional() });

/** Partial edit of one requirement. Omitted fields keep their stored values; `config` merges key by key. */
export const requirementPatchSchema = z.object({
  status: z.enum(REQUIREMENT_STATUSES).optional(),
  currency: z.enum(CURRENCIES).optional(),
  proposedBudget: z.union([z.number(), z.null(), z.literal("")]).optional().transform((v) => (v === "" ? null : v)),
  adSpend: z.union([z.number(), z.null(), z.literal("")]).optional().transform((v) => (v === "" ? null : v)),
  agencyFee: z.union([z.number(), z.null(), z.literal("")]).optional().transform((v) => (v === "" ? null : v)),
  config: z.record(z.string(), z.unknown()).optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
});

const amount = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.number().min(0, "Cannot be negative").max(1e12, "Too large").nullable());
const dateOpt = optionalDateString;

export const handoverServiceSchema = z.object({
  requirementId: objectId,
  confirmedScope: z.string().trim().min(5, "Describe the confirmed scope").max(5000),
  deliverables: z
    .array(z.object({ type: z.string().trim().min(1, "Enter a deliverable").max(80), quantity: z.coerce.number().int("Use a whole number").min(1, "At least 1").max(100000), specifications: z.string().trim().max(1000).optional().default("") }))
    .max(50)
    .default([]),
  approvedBudget: amount.default(null),
  agencyFee: amount.default(null),
  adSpend: amount.default(null),
  estimatedHours: amount.default(null),
  startDate: dateOpt,
  endDate: dateOpt,
});

const team = z.object({
  primaryPm: objectId.nullish(),
  supportingPms: z.array(objectId).max(10).optional().default([]),
  coordinator: objectId.nullish(),
  handoverNotes: z.string().trim().max(5000).optional().default(""),
  proposedHandoverDate: dateOpt,
});

export const createHandoverSchema = z
  .object({
    project: z.object({
      name: z.string().trim().min(3, "Name is too short").max(150),
      description: z.string().trim().max(5000).optional().default(""),
      startDate: dateOpt,
      endDate: dateOpt,
      priority: z.enum(TASK_PRIORITIES).default("MEDIUM"),
      currency: z.enum(CURRENCIES).default(DEFAULT_CURRENCY),
      notes: z.string().trim().max(10000).optional().default(""),
    }),
    services: z.array(handoverServiceSchema).min(1, "Select at least one approved service").max(20),
    team: team.default({ supportingPms: [], handoverNotes: "" }),
    /** false saves a draft; true submits to the nominated Project Manager straight away. */
    submit: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    const { startDate, endDate } = v.project;
    if (startDate && endDate && endDate < startDate) ctx.addIssue({ code: "custom", path: ["project", "endDate"], message: "Delivery date must be on or after the start date" });
    v.services.forEach((s, i) => {
      if (s.startDate && s.endDate && s.endDate < s.startDate) ctx.addIssue({ code: "custom", path: ["services", i, "endDate"], message: "End date must be on or after the start date" });
    });
    if (v.submit && !v.team.primaryPm) ctx.addIssue({ code: "custom", path: ["team", "primaryPm"], message: "Select the primary Project Manager before submitting" });
  });
export type CreateHandoverInput = z.output<typeof createHandoverSchema>;

const reviseAmount = z.union([z.literal(""), z.null(), z.coerce.number().min(0, "Cannot be negative").max(1e12, "Too large")]).optional();

/** One service the Project Manager edited. Omitted fields keep their stored values. */
export const reviseServiceSchema = z.object({
  id: objectId,
  confirmedScope: z.string().trim().min(5, "Describe the confirmed scope").max(5000).optional(),
  deliverables: z
    .array(z.object({ id: objectId.nullish(), type: z.string().trim().min(1, "Enter a deliverable").max(80), quantity: z.coerce.number().int("Use a whole number").min(1, "At least 1").max(100000), specifications: z.string().trim().max(1000).optional().default("") }))
    .max(50)
    .optional(),
  // undefined = leave as is; "" or null = clear.
  approvedBudget: reviseAmount,
  agencyFee: reviseAmount,
  adSpend: reviseAmount,
  estimatedHours: reviseAmount,
});

export const handoverActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("submit") }),
  z.object({ action: z.literal("nominate"), team: team.extend({ primaryPm: objectId }) }),
  /** Approving onboards the client and tells the heads and team leaders of the departments chosen here. */
  z.object({ action: z.literal("accept"), departments: z.array(objectId).min(1, "Select at least one department").max(10, "Up to 10 departments") }),
  /** The Project Manager corrects the scope before approving. The reason is required and shown to Sales. */
  z.object({ action: z.literal("revise"), reason: z.string().trim().min(MIN_REJECTION_REASON, `Explain what you changed and why, in at least ${MIN_REJECTION_REASON} characters`).max(1500), services: z.array(reviseServiceSchema).min(1).max(20) }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(MIN_REJECTION_REASON, `Explain why in at least ${MIN_REJECTION_REASON} characters`).max(2000) }),
]);
export type HandoverActionInput = z.output<typeof handoverActionSchema>;

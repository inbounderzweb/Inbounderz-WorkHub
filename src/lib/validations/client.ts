import { z } from "zod";
import { CLIENT_STATUSES, CURRENCIES, DEFAULT_CURRENCY } from "@/lib/constants";
import { validateGstin } from "@/lib/gst";
import { normalizePhone } from "@/lib/clients/normalize";
import { requirementInputSchema } from "@/lib/clients/service-requirements";
import { objectId, optionalObjectId, paginationSchema } from "./common";

const text = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`).optional().default("");
const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address")
  .optional()
  .default("");
const phone = z
  .string()
  .trim()
  .max(30)
  .refine((v) => !v || /^\+?[\d\s().-]{6,30}$/.test(v), "Enter a valid phone number")
  .refine((v) => !v || normalizePhone(v) !== "", "Phone number is too short")
  .optional()
  .default("");
/** Adds https:// when missing and only allows http(s). */
const website = z
  .string()
  .trim()
  .max(300)
  .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
  .refine((v) => {
    if (!v) return true;
    try {
      const u = new URL(v);
      return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".");
    } catch {
      return false;
    }
  }, "Enter a valid website address")
  .optional()
  .default("");

export const addressSchema = z.object({
  line1: text(200),
  line2: text(200),
  city: text(100),
  state: text(100),
  postalCode: text(20),
  country: z.string().trim().max(100).optional().default("India"),
});

/** Optional. Empty GSTIN means "no GST details". Format and checksum only. */
export const gstSchema = z
  .object({
    gstin: z.string().trim().max(20).optional().default(""),
    legalName: text(200),
  })
  .superRefine((v, ctx) => {
    if (!v.gstin) return;
    const r = validateGstin(v.gstin);
    if (!r.valid) ctx.addIssue({ code: "custom", path: ["gstin"], message: r.reason });
  });

const alternateContact = z.object({ name: text(120), email, phone });

const clientFields = {
  name: z.string().trim().min(2, "Enter the company name").max(150),
  contactPerson: z.string().trim().min(2, "Enter a contact person").max(120),
  contactDesignation: text(120),
  contactEmail: email,
  contactPhone: phone,
  email,
  phone,
  alternatePhone: phone,
  alternateContact: alternateContact.optional(),
  businessCategory: text(80),
  website,
  businessAddress: addressSchema.optional(),
  billingSameAsBusiness: z.boolean().optional(),
  billingAddress: addressSchema.optional(),
  gst: gstSchema.optional(),
  defaultCurrency: z.enum(CURRENCIES).optional().default(DEFAULT_CURRENCY),
  notes: text(5000),
  status: z.enum(CLIENT_STATUSES).optional(),
};

const needContact = (v: { email?: string; phone?: string }, ctx: z.RefinementCtx) => {
  if (!v.email && !v.phone) {
    ctx.addIssue({ code: "custom", path: ["email"], message: "Enter an email or a phone number" });
  }
};

export const createClientSchema = z
  .object({
    ...clientFields,
    /** Admin only: assign another Sales Executive as owner. Everyone else owns what they create. */
    salesOwner: optionalObjectId,
    /** The Project Manager who reviews and approves the onboarding. */
    projectManager: optionalObjectId,
    /** Services the client wants, collected during onboarding. Each is validated for its service type. */
    requirements: z.array(requirementInputSchema).max(30).optional().default([]),
    /** Soft warnings (same email or phone alone, similar name) were shown and accepted. */
    acknowledgeDuplicates: z.boolean().optional().default(false),
    /** Admin only: create despite a hard duplicate block. A reason is mandatory. */
    duplicateOverrideReason: z.string().trim().max(1000).optional().default(""),
  })
  .superRefine(needContact);

export const updateClientSchema = z
  .object({
    name: clientFields.name.optional(),
    contactPerson: clientFields.contactPerson.optional(),
    contactDesignation: z.string().trim().max(120).optional(),
    contactEmail: z.string().trim().toLowerCase().max(254).refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address").optional(),
    contactPhone: z.string().trim().max(30).refine((v) => !v || /^\+?[\d\s().-]{6,30}$/.test(v), "Enter a valid phone number").optional(),
    alternatePhone: z.string().trim().max(30).refine((v) => !v || /^\+?[\d\s().-]{6,30}$/.test(v), "Enter a valid phone number").optional(),
    email: z.string().trim().toLowerCase().max(254).refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address").optional(),
    phone: z.string().trim().max(30).refine((v) => !v || /^\+?[\d\s().-]{6,30}$/.test(v), "Enter a valid phone number").optional(),
    alternateContact: alternateContact.optional(),
    businessCategory: z.string().trim().max(80).optional(),
    website: clientFields.website.optional(),
    businessAddress: addressSchema.optional(),
    billingSameAsBusiness: z.boolean().optional(),
    billingAddress: addressSchema.optional(),
    gst: gstSchema.optional(),
    defaultCurrency: z.enum(CURRENCIES).optional(),
    notes: z.string().trim().max(5000).optional(),
    status: z.enum(CLIENT_STATUSES).optional(),
    salesOwner: optionalObjectId,
    projectManager: optionalObjectId,
    acknowledgeDuplicates: z.boolean().optional().default(false),
    duplicateOverrideReason: z.string().trim().max(1000).optional().default(""),
    /** Optimistic concurrency: the `updatedAt` the editor started from. */
    expectedUpdatedAt: z.string().datetime().optional(),
    requirements: z.array(requirementInputSchema).max(30).optional(),
    /** Optional note stored with the history entry. */
    reason: z.string().trim().max(1000).optional().default(""),
  })
  .superRefine((v, ctx) => {
    if (v.email === "" && v.phone === "") ctx.addIssue({ code: "custom", path: ["email"], message: "Keep an email or a phone number" });
  });

export const checkDuplicatesSchema = z.object({
  name: z.string().trim().min(2).max(150),
  email: email,
  phone: z.string().trim().max(30).optional().default(""),
  /** When editing, the client itself is not a duplicate of itself. */
  excludeId: optionalObjectId,
});

export const clientListQuerySchema = paginationSchema.extend({
  status: z.union([z.literal(""), z.enum(CLIENT_STATUSES)]).optional().default(""),
  owner: optionalObjectId,
  sort: z.enum(["recent", "name"]).optional().default("recent"),
});

export const clientContactSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(120),
  designation: text(120),
  email,
  phone,
  notes: text(1000),
});
export const updateClientContactSchema = clientContactSchema.partial();

export const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const duplicateReviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["OPEN", "NOT_DUPLICATE", "CONFIRMED_DUPLICATE", "ALL"]).optional().default("OPEN"),
});

export const resolveDuplicateReviewSchema = z.object({
  decision: z.enum(["NOT_DUPLICATE", "CONFIRMED_DUPLICATE"]),
  note: z.string().trim().min(3, "Add a short note explaining the decision").max(1000),
});

export type CreateClientInput = z.output<typeof createClientSchema>;
export type UpdateClientInput = z.output<typeof updateClientSchema>;
export { objectId };

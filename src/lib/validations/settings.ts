import { z } from "zod";
import { ROLE_KEYS, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/constants";
import { PERMISSIONS, type Permission } from "@/lib/permissions";

const perm = z.enum(Object.keys(PERMISSIONS) as [Permission, ...Permission[]]);
const optionalText = (max: number) => z.string().trim().max(max);

/** Every section optional: the Settings screens save one section at a time. */
export const settingsPatchSchema = z
  .object({
    company: z
      .object({
        name: z.string().trim().min(1, "Company name is required").max(120),
        legalName: optionalText(200),
        email: z.union([z.literal(""), z.email("Enter a valid email")]),
        phone: optionalText(40),
        website: z.union([z.literal(""), z.url("Enter a full URL, e.g. https://inbounderz.com")]),
        address: optionalText(500),
        timezone: z.string().trim().min(1).max(60),
      })
      .partial(),
    taskStatuses: z.partialRecord(z.enum(TASK_STATUSES), z.object({ label: z.string().max(30), enabled: z.boolean() }).partial()),
    priorities: z.partialRecord(z.enum(TASK_PRIORITIES), z.object({ label: z.string().max(30), responseDays: z.number().int().min(0).max(90) }).partial()),
    defaultPriority: z.enum(TASK_PRIORITIES),
    permissionOverrides: z.partialRecord(z.enum(ROLE_KEYS), z.object({ grant: z.array(perm).max(30), revoke: z.array(perm).max(30) }).partial()),
    reminders: z.object({ taskDueSoonHours: z.number().int().min(1).max(168), projectDueSoonDays: z.number().int().min(1).max(30) }).partial(),
    dailyUpdates: z.object({ backdateDays: z.number().int().min(0).max(31), maxHoursPerDay: z.number().min(1).max(24) }).partial(),
  })
  .partial();

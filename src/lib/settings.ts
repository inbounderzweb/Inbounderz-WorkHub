import "server-only";
import { connectDB } from "@/lib/db";
import { OPTIONAL_TASK_STATUSES, TASK_PRIORITIES, TASK_STATUSES, humanize, type TaskStatus } from "@/lib/constants";
import { setPermissionOverrides, type PermissionOverrides } from "@/lib/permissions";
import { DEFAULT_PRIORITY_RESPONSE_DAYS, type PublicSettings } from "@/lib/settings-types";
import { SystemSetting } from "@/models";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* Loader for the system settings document. Kept free of request/auth imports
   (getCurrentUser calls it), so it can't create an import cycle. */

export type ResolvedSettings = PublicSettings & {
  permissionOverrides: PermissionOverrides;
  reminders: { taskDueSoonHours: number; projectDueSoonDays: number };
  updatedAt: string | null;
};

const TTL_MS = 15_000;

declare global {
  var __workhubSettings: { value: ResolvedSettings; at: number } | undefined;
}

function resolve(doc: any): ResolvedSettings {
  const ts = doc?.taskStatuses ?? {};
  const pr = doc?.priorities ?? {};
  return {
    company: {
      name: doc?.company?.name || "Inbounderz",
      legalName: doc?.company?.legalName ?? "",
      email: doc?.company?.email ?? "",
      phone: doc?.company?.phone ?? "",
      website: doc?.company?.website ?? "",
      address: doc?.company?.address ?? "",
      timezone: doc?.company?.timezone || "Asia/Kolkata",
    },
    taskStatuses: Object.fromEntries(
      TASK_STATUSES.map((s) => [
        s,
        {
          label: ts[s]?.label || humanize(s),
          enabled: OPTIONAL_TASK_STATUSES.includes(s) ? ts[s]?.enabled !== false : true,
        },
      ])
    ) as PublicSettings["taskStatuses"],
    priorities: Object.fromEntries(
      TASK_PRIORITIES.map((p) => [p, { label: pr[p]?.label || humanize(p), responseDays: pr[p]?.responseDays ?? DEFAULT_PRIORITY_RESPONSE_DAYS[p] }])
    ) as PublicSettings["priorities"],
    defaultPriority: (TASK_PRIORITIES as readonly string[]).includes(doc?.defaultPriority) ? doc.defaultPriority : "MEDIUM",
    dailyUpdates: {
      backdateDays: doc?.dailyUpdates?.backdateDays ?? 7,
      maxHoursPerDay: doc?.dailyUpdates?.maxHoursPerDay ?? 16,
    },
    permissionOverrides: doc?.permissionOverrides ?? {},
    reminders: {
      taskDueSoonHours: doc?.reminders?.taskDueSoonHours ?? 24,
      projectDueSoonDays: doc?.reminders?.projectDueSoonDays ?? 3,
    },
    updatedAt: doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
  };
}

function install(value: ResolvedSettings) {
  globalThis.__workhubSettings = { value, at: Date.now() };
  setPermissionOverrides(value.permissionOverrides);
  return value;
}

/**
 * Loads settings (cached for 15 s per server instance) and installs the
 * permission overrides used by the synchronous `hasPermission`. Called on every
 * authenticated request via getCurrentUser, so a change made on one instance
 * reaches the others within the TTL.
 */
export async function getSystemSettings(force = false): Promise<ResolvedSettings> {
  const cached = globalThis.__workhubSettings;
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.value;
  await connectDB();
  const doc = await SystemSetting.findOne({ key: "system" }).lean();
  return install(resolve(doc));
}

/** Last loaded settings (defaults before the first load). For synchronous code paths. */
export function cachedSettings(): ResolvedSettings {
  return globalThis.__workhubSettings?.value ?? resolve(null);
}

export function toPublicSettings(s: ResolvedSettings): PublicSettings {
  return { company: s.company, taskStatuses: s.taskStatuses, priorities: s.priorities, defaultPriority: s.defaultPriority, dailyUpdates: s.dailyUpdates };
}

/** Task statuses currently switched off (never includes statuses tasks are sitting in). */
export function disabledTaskStatuses(): TaskStatus[] {
  const s = cachedSettings();
  return TASK_STATUSES.filter((st) => !s.taskStatuses[st].enabled);
}


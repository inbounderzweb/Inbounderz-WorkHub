import "server-only";
import type { CurrentUser } from "@/lib/auth/current-user";
import { forbidden, unprocessable } from "@/lib/api";
import { diffFields, recordAudit } from "@/lib/audit";
import {
  OPTIONAL_TASK_STATUSES,
  ROLE_KEYS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  humanize,
  type RoleKey,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/constants";
import { CONFIGURABLE_PERMISSIONS, hasPermission, type Permission, type PermissionOverrides } from "@/lib/permissions";
import { getSystemSettings, type ResolvedSettings } from "@/lib/settings";
import { SystemSetting, Task } from "@/models";
import { oid } from "./scope";

/* eslint-disable @typescript-eslint/no-explicit-any */

export { getSystemSettings };

/* ------------------------------------------------------------------ */

export type SettingsPatch = {
  company?: Partial<ResolvedSettings["company"]>;
  taskStatuses?: Partial<Record<TaskStatus, { label?: string; enabled?: boolean }>>;
  priorities?: Partial<Record<TaskPriority, { label?: string; responseDays?: number }>>;
  defaultPriority?: TaskPriority;
  permissionOverrides?: Partial<Record<RoleKey, { grant?: Permission[]; revoke?: Permission[] }>>;
  reminders?: Partial<ResolvedSettings["reminders"]>;
  dailyUpdates?: Partial<ResolvedSettings["dailyUpdates"]>;
};

function validTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function updateSystemSettings(user: CurrentUser, patch: SettingsPatch): Promise<ResolvedSettings> {
  if (!hasPermission(user.role, "settings:manage")) throw forbidden();
  const current = await getSystemSettings(true);
  const set: Record<string, unknown> = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  if (patch.company) {
    if (patch.company.timezone !== undefined && !validTimezone(patch.company.timezone)) {
      throw unprocessable("Unknown timezone", { "company.timezone": "Use an IANA timezone such as Asia/Kolkata" });
    }
    if (patch.company.name !== undefined && !patch.company.name.trim()) throw unprocessable("Company name is required", { "company.name": "Required" });
    Object.assign(changes, diffFields(current.company as any, patch.company as any, Object.keys(patch.company) as any));
    for (const [k, v] of Object.entries(patch.company)) set[`company.${k}`] = typeof v === "string" ? v.trim() : v;
  }

  if (patch.taskStatuses) {
    const labels = new Map<string, string>();
    for (const s of TASK_STATUSES) labels.set((patch.taskStatuses[s]?.label ?? current.taskStatuses[s].label).trim().toLowerCase(), s);
    if (labels.size !== TASK_STATUSES.length) throw unprocessable("Each task status needs a different label");
    for (const [s, v] of Object.entries(patch.taskStatuses) as [TaskStatus, { label?: string; enabled?: boolean }][]) {
      if (!v) continue;
      if (v.label !== undefined) {
        const label = v.label.trim();
        if (!label || label.length > 30) throw unprocessable(`Give ${humanize(s)} a label of 1–30 characters`);
        set[`taskStatuses.${s}.label`] = label;
      }
      if (v.enabled !== undefined && v.enabled !== current.taskStatuses[s].enabled) {
        if (!OPTIONAL_TASK_STATUSES.includes(s)) throw unprocessable(`${humanize(s)} is part of the core workflow and can't be switched off`);
        if (!v.enabled) {
          // Never strand existing records in a status that no longer exists.
          const inUse = await Task.countDocuments({ status: s });
          if (inUse) throw unprocessable(`${inUse} task(s) are currently in ${current.taskStatuses[s].label}. Move them to another status first.`);
        }
        set[`taskStatuses.${s}.enabled`] = v.enabled;
      }
      changes[`taskStatuses.${s}`] = { from: current.taskStatuses[s], to: { ...current.taskStatuses[s], ...v } };
    }
  }

  if (patch.priorities) {
    for (const [p, v] of Object.entries(patch.priorities) as [TaskPriority, { label?: string; responseDays?: number }][]) {
      if (!v) continue;
      if (v.label !== undefined) {
        if (!v.label.trim() || v.label.trim().length > 30) throw unprocessable(`Give ${humanize(p)} a label of 1–30 characters`);
        set[`priorities.${p}.label`] = v.label.trim();
      }
      if (v.responseDays !== undefined) {
        if (!Number.isInteger(v.responseDays) || v.responseDays < 0 || v.responseDays > 90) throw unprocessable("Response time must be 0–90 days");
        set[`priorities.${p}.responseDays`] = v.responseDays;
      }
      changes[`priorities.${p}`] = { from: current.priorities[p], to: { ...current.priorities[p], ...v } };
    }
  }
  if (patch.defaultPriority !== undefined) {
    if (!(TASK_PRIORITIES as readonly string[]).includes(patch.defaultPriority)) throw unprocessable("Unknown priority");
    set.defaultPriority = patch.defaultPriority;
    changes.defaultPriority = { from: current.defaultPriority, to: patch.defaultPriority };
  }

  if (patch.permissionOverrides) {
    const next: PermissionOverrides = { ...current.permissionOverrides };
    for (const [role, v] of Object.entries(patch.permissionOverrides) as [RoleKey, { grant?: Permission[]; revoke?: Permission[] }][]) {
      if (!ROLE_KEYS.includes(role)) throw unprocessable(`Unknown role ${role}`);
      if (role === "SUPER_ADMIN") throw unprocessable("Super Admin permissions can't be changed");
      const bad = [...(v.grant ?? []), ...(v.revoke ?? [])].filter((p) => !CONFIGURABLE_PERMISSIONS.includes(p));
      if (bad.length) throw unprocessable(`These permissions are fixed and can't be changed: ${bad.join(", ")}`);
      const grant = [...new Set(v.grant ?? [])];
      const revoke = [...new Set(v.revoke ?? [])].filter((p) => !grant.includes(p));
      next[role] = { grant, revoke };
    }
    set.permissionOverrides = next;
    changes.permissionOverrides = { from: current.permissionOverrides, to: next };
  }

  if (patch.reminders) {
    const { taskDueSoonHours: h, projectDueSoonDays: d } = patch.reminders;
    if (h !== undefined && (!Number.isInteger(h) || h < 1 || h > 168)) throw unprocessable("Task reminder lead time must be 1–168 hours");
    if (d !== undefined && (!Number.isInteger(d) || d < 1 || d > 30)) throw unprocessable("Project reminder lead time must be 1–30 days");
    for (const [k, v] of Object.entries(patch.reminders)) if (v !== undefined) set[`reminders.${k}`] = v;
    changes.reminders = { from: current.reminders, to: { ...current.reminders, ...patch.reminders } };
  }
  if (patch.dailyUpdates) {
    const { backdateDays: b, maxHoursPerDay: m } = patch.dailyUpdates;
    if (b !== undefined && (!Number.isInteger(b) || b < 0 || b > 31)) throw unprocessable("Backdating must be 0–31 days");
    if (m !== undefined && (!(m >= 1) || m > 24)) throw unprocessable("Maximum hours must be between 1 and 24");
    for (const [k, v] of Object.entries(patch.dailyUpdates)) if (v !== undefined) set[`dailyUpdates.${k}`] = v;
    changes.dailyUpdates = { from: current.dailyUpdates, to: { ...current.dailyUpdates, ...patch.dailyUpdates } };
  }

  if (!Object.keys(set).length) return current;
  set.updatedBy = oid(user.id);
  await SystemSetting.updateOne({ key: "system" }, { $set: set, $setOnInsert: { key: "system" } }, { upsert: true, runValidators: true });
  const sections = Object.keys(patch).join(", ");
  await recordAudit({
    actorId: user.id,
    action: patch.permissionOverrides ? "settings.permissions" : "settings.update",
    entityType: "Settings",
    summary: `Updated system settings (${sections})`,
    changes,
  });
  return getSystemSettings(true);
}

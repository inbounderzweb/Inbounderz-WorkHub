import "server-only";
import type { Types } from "mongoose";
import type { CurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/permissions";
import { DailyUpdate } from "@/models";
import { accessContext, type AccessContext } from "./access";
import { oid, type Filter } from "./scope";

/* eslint-disable @typescript-eslint/no-explicit-any */

const sid = (v: unknown): string =>
  !v ? "" : typeof v === "object" && "_id" in (v as object) ? String((v as { _id: unknown })._id) : String(v);

/**
 * - Author: own reports.
 * - Reviewer (`daily-update:review`): reports by people in departments they head
 *   (or lead, when Team Leaders are granted review). Never their own.
 * - Project Manager: read-only overview of reports on projects they manage.
 * - Team Leader: read-only view of their team's reports.
 * - Super Admin: everything, and reviews Department Heads' own reports.
 */
export type Access = AccessContext & { canReviewPerm: boolean };

export async function ctxFor(user: CurrentUser): Promise<Access> {
  const ctx = await accessContext(user);
  // accessContext only resolves headed departments for Department Heads / Super Admins.
  return { ...ctx, canReviewPerm: hasPermission(user.role, "daily-update:review") };
}

export const isAuthor = (c: Access, r: any) => sid(r.user) === c.user.id;

export function canReview(c: Access, r: any): boolean {
  if (isAuthor(c, r)) return false;
  if (c.isAdmin) return true;
  if (!c.canReviewPerm) return false;
  const dept = sid(r.department);
  return !!dept && (c.headed.has(dept) || c.led.has(dept));
}

export function canView(c: Access, r: any): boolean {
  if (c.isAdmin || isAuthor(c, r) || canReview(c, r)) return true;
  const dept = sid(r.department);
  if (dept && (c.headed.has(dept) || c.led.has(dept))) return true;
  return c.managed.has(sid(r.project));
}

/** Mongo filter for the "team" view; null = the user has no team scope. */
export function teamFilter(c: Access): Filter | null {
  if (c.isAdmin) return {};
  const or: Filter[] = [];
  const depts = [...new Set([...c.headed, ...c.led])].map((x) => oid(x));
  if (depts.length) or.push({ department: { $in: depts } });
  if (c.managed.size) or.push({ project: { $in: [...c.managed].map((x) => oid(x)) } });
  return or.length ? { $or: or, user: { $ne: oid(c.user.id) } } : null;
}

/** Attachment rules for a report (used by attachment.service). */
export async function dailyUpdateAttachmentAccess(c: AccessContext, id: Types.ObjectId) {
  const r = await DailyUpdate.findById(id).select("user department project status").lean();
  const a: Access = { ...c, canReviewPerm: hasPermission(c.user.role, "daily-update:review") };
  if (!r || !canView(a, r)) return null;
  const editable = isAuthor(a, r) && r.status !== "APPROVED";
  return { view: true, upload: editable, manage: false, editable, report: r };
}

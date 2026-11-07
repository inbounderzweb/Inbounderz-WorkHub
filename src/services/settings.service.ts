import "server-only";
import type { Types } from "mongoose";
import { escapeRegex, paginate } from "@/lib/api";
import { effectivePermissions, PERMISSIONS, ROLE_PERMISSIONS, type Permission } from "@/lib/permissions";
import type { RoleKey } from "@/lib/constants";
import { AuditLog, Role, User } from "@/models";
import type { ActivityDTO, Paginated } from "@/types/dto";
import { USER_REF_FIELDS } from "./mappers";
import { toActivity } from "./dashboard.service";

export type RoleOverview = {
  id: string;
  key: RoleKey;
  name: string;
  description: string;
  level: number;
  permissions: { key: Permission; label: string; base: boolean }[];
  revoked: Permission[];
  users: number;
  activeUsers: number;
};

export async function listRolesOverview(): Promise<RoleOverview[]> {
  const [roles, counts] = await Promise.all([
    Role.find().sort({ level: -1 }).lean(),
    User.aggregate<{ _id: Types.ObjectId; total: number; active: number }>([
      {
        $group: {
          _id: "$role",
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ["$status", "ACTIVE"] }, 1, 0] } },
        },
      },
    ]),
  ]);
  const map = new Map(counts.map((c) => [c._id.toString(), c]));
  return roles.map((r) => ({
    id: r._id.toString(),
    key: r.key as RoleKey,
    name: r.name,
    description: r.description ?? "",
    level: r.level,
    // Effective = code matrix ± overrides configured under Settings → Users & roles.
    permissions: effectivePermissions(r.key as RoleKey)
      .filter((p) => p in PERMISSIONS)
      .map((p) => ({ key: p, label: PERMISSIONS[p], base: (ROLE_PERMISSIONS[r.key as RoleKey] ?? []).includes(p) })),
    revoked: (ROLE_PERMISSIONS[r.key as RoleKey] ?? []).filter((p) => !effectivePermissions(r.key as RoleKey).includes(p)),
    users: map.get(r._id.toString())?.total ?? 0,
    activeUsers: map.get(r._id.toString())?.active ?? 0,
  }));
}

export async function listAuditLogs(opts: {
  page: number;
  pageSize: number;
  q: string;
  entityType: string;
  from?: string;
  to?: string;
}): Promise<Paginated<ActivityDTO>> {
  const filter: Record<string, unknown> = {};
  if (opts.entityType) filter.entityType = opts.entityType;
  if (opts.from || opts.to) {
    const range: Record<string, Date> = {};
    if (opts.from) range.$gte = new Date(`${opts.from}T00:00:00.000Z`);
    if (opts.to) range.$lte = new Date(`${opts.to}T23:59:59.999Z`);
    filter.createdAt = range;
  }
  if (opts.q) {
    const rx = new RegExp(escapeRegex(opts.q), "i");
    filter.$or = [{ summary: rx }, { action: rx }];
  }
  const [rows, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((opts.page - 1) * opts.pageSize)
      .limit(opts.pageSize)
      .populate("actor", USER_REF_FIELDS)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);
  return paginate(rows.map(toActivity), total, opts.page, opts.pageSize);
}

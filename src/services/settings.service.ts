import "server-only";
import type { Types } from "mongoose";
import { escapeRegex, paginate } from "@/lib/api";
import { PERMISSIONS, ROLE_PERMISSIONS, LOCKED_PERMISSIONS, type Permission } from "@/lib/permissions";
import type { CurrentUser } from "@/lib/auth/current-user";
import { forbidden, unprocessable } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { loadPermissions } from "@/lib/permission-store";
import { computeEffective } from "@/lib/roles";
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
  permissions: { key: Permission; label: string }[];
  users: number;
  activeUsers: number;
  /** Cells the matrix may edit for this role: false for Super Admin. */
  editable: boolean;
};

/** Permissions that cannot be changed from the matrix. */
export const LOCKED_KEYS: readonly Permission[] = LOCKED_PERMISSIONS;

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
    permissions: (r.permissions as Permission[])
      .filter((p) => p in PERMISSIONS)
      .map((p) => ({ key: p, label: PERMISSIONS[p] })),
    users: map.get(r._id.toString())?.total ?? 0,
    activeUsers: map.get(r._id.toString())?.active ?? 0,
    editable: r.key !== "SUPER_ADMIN",
  }));
}

/**
 * Grants or revokes one permission for one role. Only a Super Admin may do this. The change is stored
 * relative to the code defaults, takes effect on the next request, and is written to the audit log.
 */
export async function setRolePermission(user: CurrentUser, roleKey: RoleKey, permission: Permission, allowed: boolean): Promise<void> {
  if (user.role !== "SUPER_ADMIN") throw forbidden("Only a Super Admin can change permissions");
  if (roleKey === "SUPER_ADMIN") throw unprocessable("Super Admin permissions can't be changed");
  if (!(permission in PERMISSIONS)) throw unprocessable("Unknown permission");
  if (LOCKED_KEYS.includes(permission)) throw unprocessable("This permission is reserved for Super Admin");

  const role = await Role.findOne({ key: roleKey });
  if (!role) throw unprocessable("Role not found");
  const isDefault = ROLE_PERMISSIONS[roleKey].includes(permission);
  const granted = new Set<string>(role.granted ?? []);
  const revoked = new Set<string>(role.revoked ?? []);
  granted.delete(permission);
  revoked.delete(permission);
  // Store only what differs from the defaults.
  if (allowed && !isDefault) granted.add(permission);
  if (!allowed && isDefault) revoked.add(permission);

  const before = computeEffective(roleKey, role.granted, role.revoked).includes(permission);
  if (before === allowed) return;
  role.granted = [...granted];
  role.revoked = [...revoked];
  role.permissions = computeEffective(roleKey, role.granted, role.revoked);
  await role.save();
  await loadPermissions(true);

  await recordAudit({
    actorId: user.id,
    action: allowed ? "role.permission_granted" : "role.permission_revoked",
    entityType: "Role",
    entityId: role._id,
    summary: `${allowed ? "Granted" : "Revoked"} "${PERMISSIONS[permission]}" (${permission}) ${allowed ? "to" : "from"} ${role.name}`,
    changes: { [permission]: { from: before, to: allowed } },
  });
}

export async function listAuditLogs(opts: {
  page: number;
  pageSize: number;
  q: string;
  entityType: string;
}): Promise<Paginated<ActivityDTO>> {
  const filter: Record<string, unknown> = {};
  if (opts.entityType) filter.entityType = opts.entityType;
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

import "server-only";
import type { Types } from "mongoose";
import { connectDB } from "./db";
import { ROLE_KEYS, ROLE_META, type RoleKey } from "./constants";
import { ROLE_PERMISSIONS, PERMISSIONS, LOCKED_PERMISSIONS, type Permission } from "./permissions";
import { Role } from "@/models";

export type RoleInfo = { id: string; key: RoleKey; name: string; level: number };

type RoleMaps = { byKey: Map<RoleKey, RoleInfo>; byId: Map<string, RoleInfo> };

declare global {
  var __roleMaps: Promise<RoleMaps> | undefined;
}

/**
 * Upserts the system roles from the code-defined matrix so the database always
 * reflects the permissions the server enforces. Idempotent.
 */
/** Code defaults plus the Super Admin's grants and revocations. Super Admin and locked permissions ignore edits. */
export function computeEffective(key: RoleKey, granted: readonly string[] = [], revoked: readonly string[] = []): Permission[] {
  if (key === "SUPER_ADMIN") return [...ROLE_PERMISSIONS[key]];
  const known = (p: string): p is Permission => p in PERMISSIONS && !LOCKED_PERMISSIONS.includes(p as Permission);
  const set = new Set<Permission>(ROLE_PERMISSIONS[key]);
  for (const p of revoked) if (known(p)) set.delete(p);
  for (const p of granted) if (known(p)) set.add(p);
  return [...set];
}

export async function syncRoles(): Promise<void> {
  await connectDB();
  const existing = await Role.find().select("key granted revoked").lean();
  const edits = new Map(existing.map((r) => [r.key as RoleKey, r]));
  await Role.bulkWrite(
    ROLE_KEYS.map((key) => ({
      updateOne: {
        filter: { key },
        update: {
          $set: {
            name: ROLE_META[key].name,
            description: ROLE_META[key].description,
            level: ROLE_META[key].level,
            permissions: computeEffective(key, edits.get(key)?.granted, edits.get(key)?.revoked),
            isSystem: true,
          },
        },
        upsert: true,
      },
    }))
  );
}

async function loadRoleMaps(): Promise<RoleMaps> {
  await syncRoles();
  const roles = await Role.find().lean();
  const byKey = new Map<RoleKey, RoleInfo>();
  const byId = new Map<string, RoleInfo>();
  for (const r of roles) {
    const info: RoleInfo = { id: r._id.toString(), key: r.key as RoleKey, name: r.name, level: r.level };
    byKey.set(info.key, info);
    byId.set(info.id, info);
  }
  return { byKey, byId };
}

/** Roles are static system data: load once per process. */
export async function getRoleMaps(): Promise<RoleMaps> {
  if (!globalThis.__roleMaps) {
    globalThis.__roleMaps = loadRoleMaps().catch((err) => {
      globalThis.__roleMaps = undefined;
      throw err;
    });
  }
  return globalThis.__roleMaps;
}

/** Drops the cached maps so the next lookup reloads them from MongoDB. */
function invalidateRoleMaps() {
  globalThis.__roleMaps = undefined;
}

export async function getRoleByKey(key: RoleKey): Promise<RoleInfo> {
  let role = (await getRoleMaps()).byKey.get(key);
  if (!role) {
    // A role added by a newer deployment: reload once, as getRoleById does.
    invalidateRoleMaps();
    role = (await getRoleMaps()).byKey.get(key);
  }
  if (!role) throw new Error(`Role ${key} is not configured`);
  return role;
}

/**
 * Looks a role up by id. On a cache miss (e.g. roles were re-seeded while the
 * server was running) the cache is reloaded once before giving up.
 */
export async function getRoleById(id: Types.ObjectId | string | null | undefined): Promise<RoleInfo | null> {
  if (!id) return null;
  const key = id.toString();
  const hit = (await getRoleMaps()).byId.get(key);
  if (hit) return hit;
  invalidateRoleMaps();
  return (await getRoleMaps()).byId.get(key) ?? null;
}

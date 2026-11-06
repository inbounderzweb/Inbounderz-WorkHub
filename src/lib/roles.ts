import "server-only";
import type { Types } from "mongoose";
import { connectDB } from "./db";
import { ROLE_KEYS, ROLE_META, type RoleKey } from "./constants";
import { ROLE_PERMISSIONS } from "./permissions";
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
export async function syncRoles(): Promise<void> {
  await connectDB();
  await Role.bulkWrite(
    ROLE_KEYS.map((key) => ({
      updateOne: {
        filter: { key },
        update: {
          $set: {
            name: ROLE_META[key].name,
            description: ROLE_META[key].description,
            level: ROLE_META[key].level,
            permissions: ROLE_PERMISSIONS[key],
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
  const role = (await getRoleMaps()).byKey.get(key);
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

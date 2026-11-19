import "server-only";
import { connectDB } from "./db";
import { ROLE_KEYS, type RoleKey } from "./constants";
import { setRuntimePermissions } from "./permissions";
import { computeEffective } from "./roles";
import { Role } from "@/models";

const TTL_MS = 10_000;

declare global {
  var __permLoad: { at: number; promise: Promise<void> | null } | undefined;
}

/**
 * Loads the Super Admin's permission edits from MongoDB into the process-wide table `hasPermission` reads.
 * Cached for a few seconds; the instance that saves an edit refreshes immediately, other instances pick it up
 * within the TTL.
 */
export async function loadPermissions(force = false): Promise<void> {
  const state = (globalThis.__permLoad ??= { at: 0, promise: null });
  if (!force && state.promise) return state.promise;
  if (!force && Date.now() - state.at < TTL_MS) return;
  state.promise = (async () => {
    await connectDB();
    const rows = await Role.find().select("key granted revoked").lean();
    const map: Partial<Record<RoleKey, readonly ReturnType<typeof computeEffective>[number][]>> = {};
    for (const key of ROLE_KEYS) {
      const r = rows.find((x) => x.key === key);
      map[key] = computeEffective(key, r?.granted, r?.revoked);
    }
    setRuntimePermissions(map);
    state.at = Date.now();
  })().finally(() => { state.promise = null; });
  return state.promise;
}

import "server-only";
import type { Types } from "mongoose";
import { headers } from "next/headers";
import { AuditLog } from "@/models";

type Id = Types.ObjectId | string | null | undefined;

export type AuditEntry = {
  actorId: Id;
  action: string;
  entityType: string;
  entityId?: Id;
  summary?: string;
  changes?: Record<string, { from: unknown; to: unknown }> | null;
};

async function requestMeta() {
  try {
    const h = await headers();
    return {
      ip: (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "",
      userAgent: (h.get("user-agent") ?? "").slice(0, 300),
    };
  } catch {
    return { ip: "", userAgent: "" }; // outside a request (scripts)
  }
}

/** Audit logging must never break the business operation that triggered it. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const meta = await requestMeta();
    await AuditLog.create({
      actor: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary ?? "",
      changes: entry.changes && Object.keys(entry.changes).length ? entry.changes : null,
      ...meta,
    });
  } catch (err) {
    console.error("[audit] failed to record", entry.action, err);
  }
}

function normalize(v: unknown): unknown {
  if (v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === "object" && "toHexString" in v) return String(v);
  if (Array.isArray(v)) return v.map(normalize);
  return v;
}

/** Field-level diff between two plain objects, limited to `fields`. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: (keyof T)[]
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of fields) {
    if (!(f in after)) continue;
    const from = normalize(before[f]);
    const to = normalize(after[f]);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[String(f)] = { from, to };
  }
  return changes;
}

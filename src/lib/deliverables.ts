/**
 * Deliverable rules for tickets ("2 Videos, 1 Banner"). Pure functions with no I/O, shared by the
 * server (enforcement), the UI (what to offer) and the tests.
 *
 *  - requested `quantity` is what was asked for; it only changes through an edit before approval
 *    or an authorised requirement change afterwards.
 *  - `completedQuantity` is reported by the person doing the work.
 *  - `verifiedQuantity` is confirmed by the reviewer. A deliverable is only complete when the full
 *    quantity is verified.
 *  Invariant: 0 <= verified <= completed <= quantity.
 */
import type { DeliverableStatus } from "./constants";

export type DeliverableRecord = {
  /** Existing rows carry their id; new rows have none until saved. */
  id?: string;
  type: string;
  quantity: number;
  specifications: string;
  completedQuantity: number;
  verifiedQuantity: number;
};

export type DeliverableInput = { id?: string | null; type: string; quantity: number; specifications?: string };
export type FieldErrors = Record<string, string>;

const PATH = "deliverables";
const label = (d: Pick<DeliverableRecord, "type">) => d.type.trim() || "Deliverable";

export function deliverableStatus(d: Pick<DeliverableRecord, "quantity" | "completedQuantity" | "verifiedQuantity">): DeliverableStatus {
  if (d.verifiedQuantity >= d.quantity) return "COMPLETED";
  if (d.completedQuantity >= d.quantity) return "AWAITING_VERIFICATION";
  if (d.completedQuantity > 0) return "IN_PROGRESS";
  return "NOT_STARTED";
}

/** Item counts across all deliverables ("4 of 6 verified"). Percent is based on verified items only. */
export function deliverableSummary(list: Pick<DeliverableRecord, "quantity" | "completedQuantity" | "verifiedQuantity">[]) {
  let requested = 0;
  let completed = 0;
  let verified = 0;
  for (const d of list) {
    requested += d.quantity;
    completed += Math.min(d.completedQuantity, d.quantity);
    verified += Math.min(d.verifiedQuantity, d.quantity);
  }
  return { count: list.length, requested, completed, verified, percent: requested ? Math.round((verified / requested) * 100) : 0 };
}

/** Rows whose requested quantity has not been reached yet. */
export const unfinishedDeliverables = <T extends Pick<DeliverableRecord, "quantity" | "completedQuantity">>(list: T[]) =>
  list.filter((d) => d.completedQuantity < d.quantity);

export const progressText = (d: Pick<DeliverableRecord, "type" | "quantity" | "completedQuantity">) => `${label(d)} ${d.completedQuantity}/${d.quantity}`;

/**
 * Applies an edited list to the current one. Existing rows keep their id and progress; new rows
 * start at zero. Quantities can't drop below what is already completed, and rows with completed
 * work can't be removed.
 */
export function mergeDeliverables(current: DeliverableRecord[], input: DeliverableInput[]): { next: DeliverableRecord[]; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const byId = new Map(current.filter((d) => d.id).map((d) => [d.id!, d]));
  const seen = new Set<string>();
  const next: DeliverableRecord[] = input.map((row, i) => {
    const base = { type: row.type.trim(), quantity: row.quantity, specifications: (row.specifications ?? "").trim() };
    if (!row.id) return { ...base, completedQuantity: 0, verifiedQuantity: 0 };
    const existing = byId.get(row.id);
    if (!existing || seen.has(row.id)) {
      errors[`${PATH}.${i}.type`] = "This deliverable no longer exists. Refresh and try again.";
      return { ...base, completedQuantity: 0, verifiedQuantity: 0 };
    }
    seen.add(row.id);
    if (row.quantity < existing.completedQuantity) {
      errors[`${PATH}.${i}.quantity`] = `${existing.completedQuantity} already completed, so at least ${existing.completedQuantity} is needed`;
    }
    return { ...base, id: row.id, completedQuantity: existing.completedQuantity, verifiedQuantity: existing.verifiedQuantity };
  });
  const removed = current.filter((d) => d.id && !seen.has(d.id) && d.completedQuantity > 0);
  if (removed.length) {
    errors[PATH] = `${removed.map(label).join(", ")} already ${removed.length === 1 ? "has" : "have"} completed work and can't be removed`;
  }
  return { next, errors };
}

/** Human-readable list of what changed, for the activity log and audit trail. */
export function describeDeliverableChanges(before: DeliverableRecord[], after: DeliverableRecord[]): string[] {
  const out: string[] = [];
  const old = new Map(before.filter((d) => d.id).map((d) => [d.id!, d]));
  const kept = new Set<string>();
  for (const d of after) {
    const prev = d.id ? old.get(d.id) : undefined;
    if (!prev) {
      out.push(`Added ${label(d)} × ${d.quantity}`);
      continue;
    }
    kept.add(prev.id!);
    if (prev.type !== d.type) out.push(`Renamed ${label(prev)} to ${label(d)}`);
    if (prev.quantity !== d.quantity) out.push(`${label(d)}: ${prev.quantity} → ${d.quantity}`);
    if (prev.specifications !== d.specifications) out.push(`Updated the specifications of ${label(d)}`);
  }
  for (const d of before) if (d.id && !kept.has(d.id)) out.push(`Removed ${label(d)}`);
  return out;
}

/** The assignee records how many items are done. Can't exceed the request or drop below what is verified. */
export function applyProgress(current: DeliverableRecord[], items: { id: string; completedQuantity: number }[]) {
  return applyCounts(current, items, "completedQuantity", (d, n) =>
    n > d.quantity ? `Only ${d.quantity} requested` : n < d.verifiedQuantity ? `${d.verifiedQuantity} already verified` : null
  );
}

/** The reviewer confirms how many of the completed items are accepted. */
export function applyVerification(current: DeliverableRecord[], items: { id: string; verifiedQuantity: number }[]) {
  return applyCounts(current, items, "verifiedQuantity", (d, n) => (n > d.completedQuantity ? `Only ${d.completedQuantity} completed` : null));
}

/** Approval verifies everything that was requested. */
export const verifyAll = (current: DeliverableRecord[]): DeliverableRecord[] =>
  current.map((d) => ({ ...d, verifiedQuantity: d.quantity }));

function applyCounts<K extends "completedQuantity" | "verifiedQuantity">(
  current: DeliverableRecord[],
  items: ({ id: string } & Record<K, number>)[],
  field: K,
  problem: (d: DeliverableRecord, n: number) => string | null
) {
  const errors: FieldErrors = {};
  const changes: string[] = [];
  const updates = new Map(items.map((it) => [it.id, it[field]]));
  const next = current.map((d) => ({ ...d }));
  items.forEach((it, i) => {
    const d = next.find((x) => x.id === it.id);
    const n = it[field];
    if (!d) errors[`items.${i}`] = "This deliverable no longer exists. Refresh and try again.";
    else if (!Number.isInteger(n) || n < 0) errors[`items.${i}`] = "Use a whole number of 0 or more";
    else {
      const p = problem(d, n);
      if (p) errors[`items.${i}`] = `${label(d)}: ${p}`;
    }
  });
  if (Object.keys(errors).length) return { next: current, errors, changes };
  for (const d of next) {
    const n = d.id !== undefined ? updates.get(d.id) : undefined;
    if (n === undefined || n === d[field]) continue;
    changes.push(`${label(d)}: ${d[field]} → ${n} of ${d.quantity}`);
    d[field] = n;
  }
  return { next, errors, changes };
}

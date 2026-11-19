import { CLIENT_NAME_SIMILARITY_THRESHOLD } from "@/lib/constants";
import { looseName, nameSimilarity, normalizeName } from "./normalize";

/**
 * Pure planning step of the "free-text project client → Client record" migration.
 * Given the projects and existing clients it decides, without touching the database, which
 * clients to create, which projects to link and which pairs a human must review.
 * Nothing is merged automatically: only strictly equal names (case, accents, punctuation, spacing)
 * share a record; anything merely similar becomes a review pair.
 */

export const PLACEHOLDER_NAMES = new Set(["-", "--", "n/a", "na", "none", "nil", "null", "tbd", "unknown", "not applicable"]);

export type PlanProject = { id: string; client: string | null | undefined; clientRef?: string | null };
export type PlanExistingClient = { id: string; name: string; /** Created by an earlier migration run. */ migrated?: boolean };

export type PlannedClient = {
  /** Strict normalised name; the grouping key. */
  key: string;
  /** Most frequent original spelling (ties: first seen). */
  name: string;
  spellings: string[];
  projectIds: string[];
};
export type PlannedLink = { key: string; existingClientId: string; projectIds: string[] };
export type PlannedReviewPair = {
  a: { key?: string; existingClientId?: string; name: string };
  b: { key?: string; existingClientId?: string; name: string };
  score: number;
  reasons: string[];
};

export type MigrationPlan = {
  create: PlannedClient[];
  /** Projects whose name strictly equals an existing client; linked, no new client. */
  linkExisting: PlannedLink[];
  review: PlannedReviewPair[];
  alreadyLinked: number;
  skippedPlaceholder: { projectId: string; value: string }[];
  skippedEmpty: number;
};

export function isPlaceholder(value: string): boolean {
  const v = value.trim().toLowerCase();
  return !v || PLACEHOLDER_NAMES.has(v) || !normalizeName(v);
}

export function planClientMigration(projects: PlanProject[], existing: PlanExistingClient[]): MigrationPlan {
  const plan: MigrationPlan = { create: [], linkExisting: [], review: [], alreadyLinked: 0, skippedPlaceholder: [], skippedEmpty: 0 };
  const existingByKey = new Map<string, PlanExistingClient>();
  for (const c of existing) if (!existingByKey.has(normalizeName(c.name))) existingByKey.set(normalizeName(c.name), c);

  type Group = { spellings: Map<string, number>; projectIds: string[] };
  const groups = new Map<string, Group>();
  for (const p of projects) {
    if (p.clientRef) {
      plan.alreadyLinked++;
      continue;
    }
    const raw = (p.client ?? "").trim();
    if (!raw) {
      plan.skippedEmpty++;
      continue;
    }
    if (isPlaceholder(raw)) {
      plan.skippedPlaceholder.push({ projectId: p.id, value: raw });
      continue;
    }
    const key = normalizeName(raw);
    const g: Group = groups.get(key) ?? { spellings: new Map<string, number>(), projectIds: [] as string[] };
    g.spellings.set(raw, (g.spellings.get(raw) ?? 0) + 1);
    g.projectIds.push(p.id);
    groups.set(key, g);
  }

  const created: PlannedClient[] = [];
  for (const [key, g] of groups) {
    const spellings = [...g.spellings.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
    const match = existingByKey.get(key);
    if (match) plan.linkExisting.push({ key, existingClientId: match.id, projectIds: g.projectIds });
    else created.push({ key, name: spellings[0], spellings, projectIds: g.projectIds });
  }
  plan.create = created.sort((a, b) => a.name.localeCompare(b.name));

  // Review pairs: every planned client against the other planned ones and against existing clients.
  const reasonFor = (a: string, b: string): { score: number; reasons: string[] } | null => {
    const score = nameSimilarity(a, b);
    const reasons: string[] = [];
    if (looseName(a) && looseName(a) === looseName(b)) reasons.push("Same name apart from legal suffix (Pvt Ltd, LLP, Inc…)");
    else if (score >= CLIENT_NAME_SIMILARITY_THRESHOLD) reasons.push(`Similar name (${Math.round(score * 100)}% match)`);
    return reasons.length ? { score, reasons } : null;
  };
  for (let i = 0; i < plan.create.length; i++) {
    const a = plan.create[i];
    for (let j = i + 1; j < plan.create.length; j++) {
      const b = plan.create[j];
      const r = reasonFor(a.name, b.name);
      if (r) plan.review.push({ a: { key: a.key, name: a.name }, b: { key: b.key, name: b.name }, ...r });
    }
    for (const c of existing) {
      if (normalizeName(c.name) === a.key) continue;
      const r = reasonFor(a.name, c.name);
      if (r) plan.review.push({ a: { key: a.key, name: a.name }, b: { existingClientId: c.id, name: c.name }, ...r });
    }
  }
  // Pairs among clients an earlier run already created. Re-detecting them lets a run that stopped
  // half-way finish its review queue; creation is idempotent per pair.
  const migrated = existing.filter((c) => c.migrated);
  for (let i = 0; i < migrated.length; i++) {
    for (let j = i + 1; j < migrated.length; j++) {
      const r = reasonFor(migrated[i].name, migrated[j].name);
      if (r) plan.review.push({ a: { existingClientId: migrated[i].id, name: migrated[i].name }, b: { existingClientId: migrated[j].id, name: migrated[j].name }, ...r });
    }
  }
  return plan;
}

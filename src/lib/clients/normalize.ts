/**
 * Normalisation and similarity for client duplicate detection.
 * Pure functions, shared by the service, the migration script and the tests.
 */

export function normalizeEmail(input: string | null | undefined): string {
  return (input ?? "").trim().toLowerCase();
}

/**
 * Digits only, with Indian trunk/country prefixes removed so "+91 98765-43210", "098765 43210" and
 * "9876543210" compare equal. Numbers with fewer than 7 digits are treated as missing.
 */
export function normalizePhone(input: string | null | undefined): string {
  let d = (input ?? "").replace(/\D+/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d.length >= 7 ? d : "";
}

const strip = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

/** Strict: case, accents, punctuation and spacing only. "Acme Pvt. Ltd" stays distinct from "Acme". */
export function normalizeName(input: string | null | undefined): string {
  return strip(input ?? "");
}

const LEGAL_WORDS = new Set([
  "pvt", "private", "ltd", "limited", "llp", "llc", "inc", "incorporated", "corp", "corporation",
  "co", "company", "plc", "pty", "gmbh", "the", "and",
]);

/** Loose: strict form without legal-entity words. "Acme Pvt Ltd" and "ACME" collapse to "acme". */
export function looseName(input: string | null | undefined): string {
  return normalizeName(input)
    .split(" ")
    .filter((w) => w && !LEGAL_WORDS.has(w))
    .join(" ");
}

/** First significant word of the loose name; cheap index key for finding fuzzy candidates. */
export function nameKey(input: string | null | undefined): string {
  return looseName(input).split(" ")[0] ?? "";
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const padded = ` ${s} `;
  for (let i = 0; i < padded.length - 1; i++) {
    const g = padded.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Sorensen-Dice similarity of two names on their loose forms, 0 to 1. */
export function nameSimilarity(a: string, b: string): number {
  const x = looseName(a);
  const y = looseName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const gx = bigrams(x);
  const gy = bigrams(y);
  let overlap = 0;
  for (const [g, n] of gx) overlap += Math.min(n, gy.get(g) ?? 0);
  const total = [...gx.values()].reduce((s, n) => s + n, 0) + [...gy.values()].reduce((s, n) => s + n, 0);
  return total ? (2 * overlap) / total : 0;
}

/** Key for the atomic hard-block index. Empty when either part is missing (then no block applies). */
export function dedupeKey(email: string | null | undefined, phone: string | null | undefined): string {
  const e = normalizeEmail(email);
  const p = normalizePhone(phone);
  return e && p ? `${e}|${p}` : "";
}

export type DuplicateLevel = "BLOCK" | "CONTACT" | "NAME";
export type DuplicateCandidate = {
  id: string;
  normEmail: string;
  normPhone: string;
  name: string;
};
export type DuplicateProbe = { name: string; email?: string | null; phone?: string | null };
export type DuplicateHit = { id: string; level: DuplicateLevel; matched: ("email" | "phone" | "name")[]; score: number };

/**
 * Classifies one existing client against a new/edited one.
 * BLOCK: email AND phone both match. CONTACT: exactly one of them matches. NAME: same or very
 * similar company name (>= threshold). Returns null when nothing matches.
 */
export function classifyDuplicate(probe: DuplicateProbe, other: DuplicateCandidate, threshold: number): DuplicateHit | null {
  const email = normalizeEmail(probe.email);
  const phone = normalizePhone(probe.phone);
  const emailHit = !!email && email === other.normEmail;
  const phoneHit = !!phone && phone === other.normPhone;
  const score = nameSimilarity(probe.name, other.name);
  const matched: DuplicateHit["matched"] = [];
  if (emailHit) matched.push("email");
  if (phoneHit) matched.push("phone");
  if (emailHit && phoneHit) return { id: other.id, level: "BLOCK", matched, score };
  if (emailHit || phoneHit) {
    if (score >= threshold) matched.push("name");
    return { id: other.id, level: "CONTACT", matched, score };
  }
  if (score >= threshold) return { id: other.id, level: "NAME", matched: ["name"], score };
  return null;
}

/** Stable key for an unordered pair of ids (idempotent duplicate-review rows). */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

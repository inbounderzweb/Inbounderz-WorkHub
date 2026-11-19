/** Pure unit checks for service requirements and the handover rules. No app, database or network needed. */
import assert from "node:assert/strict";
import { amountLines, defaultConfig, parseRequirement, summarizeRequirement } from "../src/lib/clients/service-requirements";
import { handoverTransition, statusEditError, teamConflicts } from "../src/lib/handover";

let n = 0;
const t = (label: string, fn: () => void) => { fn(); n++; console.log(`PASS ${label}`); };
const ok = (raw: unknown, opts = {}) => { const r = parseRequirement(raw, opts); assert.ok(r.ok, JSON.stringify(r)); return r.value; };
const bad = (raw: unknown) => { const r = parseRequirement(raw); assert.ok(!r.ok, "expected failure"); return r.errors; };

t("selecting a service is only interest: no scope or amount needed", () => {
  const v = ok({ serviceType: "SMM" });
  assert.equal(v.status, "INTERESTED");
  assert.equal(v.currency, "INR");
  assert.equal(v.proposedBudget, null);
});
t("a collected SMM requirement needs a quantity, a platform and a billing cycle", () => {
  const e = bad({ serviceType: "SMM", status: "REQUIREMENT_COLLECTED", config: {} });
  assert.ok(e["config.posters"] && e["config.platforms"] && e["config.billingCycle"]);
  const v = ok({ serviceType: "SMM", status: "REQUIREMENT_COLLECTED", config: { posters: "12", videos: 4, platforms: ["Instagram", "Facebook"], billingCycle: "MONTHLY" } });
  assert.equal(v.config.posters, 12);
  assert.match(v.summary, /12 posters · 4 videos · Instagram, Facebook · monthly/);
});
t("quoted and approved requirements need an amount; interested ones do not", () => {
  const cfg = { posters: 5, platforms: ["Instagram"], billingCycle: "ONE_TIME" };
  assert.ok(bad({ serviceType: "SMM", status: "QUOTED", config: cfg }).proposedBudget);
  assert.ok(bad({ serviceType: "SMM", status: "APPROVED", config: cfg, proposedBudget: 0 }).proposedBudget);
  assert.equal(ok({ serviceType: "SMM", status: "APPROVED", config: cfg, proposedBudget: 25000 }).proposedBudget, 25000);
});
t("not proceeding can always be saved, even with an empty scope", () => {
  assert.equal(ok({ serviceType: "WEBSITE", status: "NOT_PROCEEDING" }).status, "NOT_PROCEEDING");
});
t("SEM keeps advertising spend and agency fee as separate values", () => {
  const v = ok({ serviceType: "SEM", status: "QUOTED", adSpend: 100000, agencyFee: 15000, proposedBudget: 999, config: { searchAds: true, campaigns: 3 } });
  assert.equal(v.adSpend, 100000);
  assert.equal(v.agencyFee, 15000);
  assert.equal(v.proposedBudget, null, "SEM has no single budget");
  assert.deepEqual(amountLines({ serviceType: "SEM", proposedBudget: null, adSpend: 100000, agencyFee: 15000 }).map((l) => l.label), ["Advertising spend", "Agency fee"]);
  assert.ok(bad({ serviceType: "SEM", status: "QUOTED", config: { searchAds: true, campaigns: 1 } }).adSpend);
});
t("services that can't carry ad spend or an agency fee drop them", () => {
  const v = ok({ serviceType: "SEO", adSpend: 5, agencyFee: 5, proposedBudget: 9000 });
  assert.equal(v.adSpend, null);
  assert.equal(v.agencyFee, null);
  assert.equal(v.proposedBudget, 9000);
});
t("each service rejects fields of another service and bad values", () => {
  const v = ok({ serviceType: "SEO", config: { websiteSeo: true, posters: 99, targetKeywords: "20" } });
  assert.equal("posters" in v.config, false);
  assert.equal(v.config.targetKeywords, 20);
  assert.ok(bad({ serviceType: "SMM", config: { posters: -1 } })["config.posters"]);
  assert.ok(bad({ serviceType: "SMM", config: { posters: 1.5 } })["config.posters"]);
  assert.ok(bad({ serviceType: "SMM", config: { platforms: ["MySpace"] } })["config.platforms"]);
  assert.ok(bad({ serviceType: "NOPE" })["serviceType"]);
  assert.ok(bad({ serviceType: "SMM", currency: "XXX" })["currency"]);
  assert.ok(bad({ serviceType: "SMM", proposedBudget: -5 })["proposedBudget"]);
});
t("website and video requirements need their key fields once collected", () => {
  const w = bad({ serviceType: "WEBSITE", status: "REQUIREMENT_COLLECTED" });
  assert.ok(w["config.websiteType"] && w["config.pages"]);
  assert.match(ok({ serviceType: "WEBSITE", status: "REQUIREMENT_COLLECTED", config: { websiteType: "SHOPIFY", pages: 12, ecommerce: true } }).summary, /Shopify · 12 pages · e-commerce/);
  const v = bad({ serviceType: "VIDEO", status: "REQUIREMENT_COLLECTED" });
  assert.ok(v["config.fullAiVideo"] && v["config.videos"] && v["config.language"]);
});
t("quick work needs a title and a sane deadline, and the entry date is set by the server", () => {
  assert.ok(bad({ serviceType: "QUICK_WORK" })["config.title"]);
  const v = ok({ serviceType: "QUICK_WORK", config: { title: "Fix banner", entryDate: "1999-01-01", deadline: "2026-12-01" } }, { today: "2026-11-18" });
  assert.equal(v.config.entryDate, "2026-11-18", "client-supplied entry date is ignored");
  const kept = ok({ serviceType: "QUICK_WORK", config: { title: "Fix banner" } }, { existingEntryDate: "2026-10-01", today: "2026-11-18" });
  assert.equal(kept.config.entryDate, "2026-10-01", "editing preserves the original entry date");
  assert.ok(parseRequirement({ serviceType: "QUICK_WORK", config: { title: "x1", deadline: "2026-01-01" } }, { today: "2026-11-18" }).ok === false);
  assert.equal(v.proposedBudget, null, "quick-work budget is optional");
});
t("defaults exist for every service so a newly opened card is valid input", () => {
  for (const type of ["SMM", "SEM", "SEO", "WEBSITE", "VIDEO", "QUICK_WORK"] as const) {
    const cfg = defaultConfig(type);
    assert.ok(Object.keys(cfg).length > 3, type);
    if (type !== "QUICK_WORK") assert.ok(parseRequirement({ serviceType: type, config: cfg }).ok, type);
  }
  assert.equal(summarizeRequirement("SMM", {}), "");
});
t("project status edits cannot enter, leave or skip the handover", () => {
  assert.equal(statusEditError("PLANNING", "ACTIVE"), null);
  assert.equal(statusEditError("ACTIVE", "ON_HOLD"), null);
  assert.ok(statusEditError("DRAFT", "PLANNING"));
  assert.ok(statusEditError("HANDOVER_PENDING", "ACTIVE"));
  assert.ok(statusEditError("PM_REJECTED", "PLANNING"));
  assert.ok(statusEditError("PLANNING", "HANDOVER_PENDING"));
  assert.ok(statusEditError("PLANNING", "PM_ACCEPTED"));
  assert.ok(statusEditError("PM_ACCEPTED", "ACTIVE"), "must pass through planning");
  assert.equal(statusEditError("PM_ACCEPTED", "PLANNING"), null);
  assert.equal(statusEditError("HANDOVER_PENDING", "HANDOVER_PENDING"), null);
});
t("handover transitions", () => {
  assert.deepEqual(handoverTransition("submit", "DRAFT", "DRAFT"), { project: "HANDOVER_PENDING", assignment: "PENDING" });
  assert.deepEqual(handoverTransition("accept", "HANDOVER_PENDING", "PENDING"), { project: "PM_ACCEPTED", assignment: "ACCEPTED" });
  assert.deepEqual(handoverTransition("reject", "HANDOVER_PENDING", "PENDING"), { project: "CANCELLED", assignment: "REJECTED" });
  assert.deepEqual(handoverTransition("nominate", "PM_REJECTED", "REJECTED"), { project: "HANDOVER_PENDING", assignment: "PENDING" });
  assert.deepEqual(handoverTransition("nominate", "HANDOVER_PENDING", "PENDING"), { project: "HANDOVER_PENDING", assignment: "PENDING" });
});
t("handover actions are refused from the wrong state", () => {
  for (const [a, p, s] of [["accept", "DRAFT", "DRAFT"], ["accept", "PM_ACCEPTED", "ACCEPTED"], ["reject", "PM_REJECTED", "REJECTED"], ["submit", "HANDOVER_PENDING", "PENDING"], ["nominate", "PLANNING", "ACCEPTED"], ["nominate", "PM_ACCEPTED", "ACCEPTED"]] as const) {
    assert.ok("error" in handoverTransition(a, p, s), `${a} from ${p}`);
  }
});
t("the primary PM cannot double as supporting PM or coordinator", () => {
  assert.equal(teamConflicts({ primaryPm: "a", supportingPms: ["b", "c"], coordinator: "d" }), null);
  assert.ok(teamConflicts({ primaryPm: "a", supportingPms: ["a"] }));
  assert.ok(teamConflicts({ primaryPm: "a", supportingPms: ["b", "b"] }));
  assert.ok(teamConflicts({ primaryPm: "a", coordinator: "a" }));
});
console.log(`\n${n} checks passed`);

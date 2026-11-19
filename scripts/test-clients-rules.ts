/** Pure checks for client rules: normalisation, duplicate classification, GSTIN, validation, migration planning. No app or database. */
import assert from "node:assert/strict";
import { validateGstin, gstinCheckChar } from "../src/lib/gst";
import {
  classifyDuplicate, dedupeKey, looseName, nameKey, nameSimilarity, normalizeEmail, normalizeName, normalizePhone, pairKey,
} from "../src/lib/clients/normalize";
import { isPlaceholder, planClientMigration } from "../src/lib/clients/migration-plan";
import { createClientSchema, gstSchema, updateClientSchema } from "../src/lib/validations/client";
import { CLIENT_NAME_SIMILARITY_THRESHOLD as T } from "../src/lib/constants";
import { ClientHistory } from "../src/models/ClientHistory";

let n = 0;
const t = (label: string, fn: () => void | Promise<void>) => Promise.resolve(fn()).then(() => { n++; console.log(`PASS ${label}`); });

async function main() {
  await t("emails normalise by case and spaces only", () => {
    assert.equal(normalizeEmail("  Sales@ACME.com "), "sales@acme.com");
    assert.equal(normalizeEmail("a.b+tag@gmail.com"), "a.b+tag@gmail.com");
  });
  await t("phone numbers compare equal across +91, 0-prefix, spacing and dashes", () => {
    for (const v of ["+91 98765-43210", "098765 43210", "9876543210", "0091 98765 43210", "(98765) 43210"]) assert.equal(normalizePhone(v), "9876543210", v);
    assert.equal(normalizePhone("12345"), "");
    assert.equal(normalizePhone(""), "");
    assert.equal(normalizePhone("+1 415 555 0100"), "14155550100");
  });
  await t("strict names ignore case, accents and punctuation but keep legal suffixes", () => {
    assert.equal(normalizeName("  ACME,  Pvt. Ltd. "), "acme pvt ltd");
    assert.equal(normalizeName("Café & Co"), "cafe and co");
    assert.notEqual(normalizeName("Acme Pvt Ltd"), normalizeName("Acme"));
  });
  await t("loose names drop legal words only", () => {
    assert.equal(looseName("Acme Pvt. Ltd."), "acme");
    assert.equal(looseName("The Acme Company Private Limited"), "acme");
    assert.equal(looseName("Acme Digital LLP"), "acme digital");
    assert.equal(nameKey("The Acme Digital"), "acme");
  });
  await t("similarity: identical loose names score 1, typos score high, unrelated names low", () => {
    assert.equal(nameSimilarity("Acme Pvt Ltd", "ACME"), 1);
    assert.ok(nameSimilarity("Inbounderz", "Inbounders") >= T);
    assert.ok(nameSimilarity("Pivura Foods", "Pivura Food") >= T);
    assert.ok(nameSimilarity("Kaicho", "Ikonix") < T);
    // A longer, different business name must not trip the warning.
    assert.ok(nameSimilarity("Acme", "Acme Digital") < T);
    assert.ok(nameSimilarity("Zenith Labs", "Zephyr Studio") < T);
    assert.equal(nameSimilarity("", "Acme"), 0);
  });
  await t("dedupe key needs both email and phone", () => {
    assert.equal(dedupeKey("A@x.com", "+91 98765 43210"), "a@x.com|9876543210");
    assert.equal(dedupeKey("a@x.com", ""), "");
    assert.equal(dedupeKey("", "9876543210"), "");
  });
  const other = { id: "1", normEmail: "a@x.com", normPhone: "9876543210", name: "Acme Traders" };
  await t("email AND phone match is a block", () => {
    const h = classifyDuplicate({ name: "Totally Different", email: "A@X.com", phone: "+91 98765 43210" }, other, T)!;
    assert.equal(h.level, "BLOCK");
    assert.deepEqual(h.matched, ["email", "phone"]);
  });
  await t("email alone or phone alone is a warning, not a block", () => {
    assert.equal(classifyDuplicate({ name: "Other", email: "a@x.com", phone: "1111111111" }, other, T)!.level, "CONTACT");
    assert.equal(classifyDuplicate({ name: "Other", email: "b@x.com", phone: "9876543210" }, other, T)!.level, "CONTACT");
  });
  await t("similar name alone is a soft name warning; unrelated is no match", () => {
    const h = classifyDuplicate({ name: "ACME Traders Pvt Ltd", email: "z@z.com", phone: "2222222222" }, other, T)!;
    assert.equal(h.level, "NAME");
    assert.equal(classifyDuplicate({ name: "Zenith Labs", email: "z@z.com", phone: "2222222222" }, other, T), null);
  });
  await t("missing probe email/phone never match empty stored values", () => {
    const blank = { id: "2", normEmail: "", normPhone: "", name: "Blank Co" };
    assert.equal(classifyDuplicate({ name: "Someone", email: "", phone: "" }, blank, T), null);
  });
  await t("pair keys ignore order", () => assert.equal(pairKey("b", "a"), pairKey("a", "b")));

  await t("GSTIN: known-valid numbers pass, state and PAN are derived", () => {
    const a = validateGstin("27AAPFU0939F1ZV");
    assert.ok(a.valid && a.stateCode === "27" && a.stateName === "Maharashtra" && a.pan === "AAPFU0939F");
    assert.ok(validateGstin("29AAGCB7383J1Z4").valid);
  });
  await t("GSTIN: lowercase and spaces are normalised", () => {
    const r = validateGstin(" 27aapfu0939f1zv ");
    assert.ok(r.valid && r.gstin === "27AAPFU0939F1ZV");
  });
  await t("GSTIN: wrong checksum, length, format and state are rejected with a reason", () => {
    const bad = (v: string, re: RegExp) => { const r = validateGstin(v); assert.ok(!r.valid && re.test(r.reason), `${v}: ${JSON.stringify(r)}`); };
    bad("27AAPFU0939F1ZX", /check digit/);
    bad("27AAPFU0939F1Z", /15 characters/);
    bad("27AAPFU09391FZV", /format/);
    bad("00AAPFU0939F1ZV", /state code/);
    bad("", /15 characters/);
  });
  await t("GSTIN: every single-character change to a valid number is caught", () => {
    const good = "27AAPFU0939F1ZV";
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let accepted = 0;
    for (let i = 0; i < 14; i++) for (const c of chars) {
      if (c === good[i]) continue;
      const v = good.slice(0, i) + c + good.slice(i + 1);
      if (validateGstin(v).valid) accepted++;
    }
    assert.equal(accepted, 0, "a one-character typo passed validation");
    assert.equal(gstinCheckChar(good.slice(0, 14)), "V");
  });

  await t("create schema: needs an email or a phone, a contact person and a name", () => {
    const base = { name: "Acme", contactPerson: "Asha" };
    assert.equal(createClientSchema.safeParse({ ...base }).success, false);
    assert.equal(createClientSchema.safeParse({ ...base, email: "a@x.com" }).success, true);
    assert.equal(createClientSchema.safeParse({ ...base, phone: "+91 98765 43210" }).success, true);
    assert.equal(createClientSchema.safeParse({ ...base, email: "nope" }).success, false);
    assert.equal(createClientSchema.safeParse({ ...base, phone: "12" }).success, false);
    assert.equal(createClientSchema.safeParse({ email: "a@x.com" }).success, false);
  });
  await t("create schema: INR is the default currency and others are accepted", () => {
    const base = { name: "Acme", contactPerson: "Asha", email: "a@x.com" };
    assert.equal(createClientSchema.parse(base).defaultCurrency, "INR");
    assert.equal(createClientSchema.parse({ ...base, defaultCurrency: "USD" }).defaultCurrency, "USD");
    assert.equal(createClientSchema.safeParse({ ...base, defaultCurrency: "XYZ" }).success, false);
  });
  await t("create schema: website gets https:// and non-web schemes are rejected", () => {
    const base = { name: "Acme", contactPerson: "Asha", email: "a@x.com" };
    assert.equal(createClientSchema.parse({ ...base, website: "acme.com" }).website, "https://acme.com");
    assert.equal(createClientSchema.safeParse({ ...base, website: "javascript:alert(1)" }).success, false);
  });
  await t("GST is optional; when given it must validate", () => {
    assert.equal(gstSchema.safeParse({}).success, true);
    assert.equal(gstSchema.safeParse({ gstin: "" }).success, true);
    assert.equal(gstSchema.safeParse({ gstin: "27AAPFU0939F1ZV" }).success, true);
    assert.equal(gstSchema.safeParse({ gstin: "27AAPFU0939F1ZX" }).success, false);
  });
  await t("update schema: cannot blank both email and phone", () => {
    assert.equal(updateClientSchema.safeParse({ email: "", phone: "" }).success, false);
    assert.equal(updateClientSchema.safeParse({ email: "" }).success, true);
  });

  await t("migration: strictly equal names share one client; spellings are kept", () => {
    const plan = planClientMigration([{ id: "p1", client: "Acme" }, { id: "p2", client: "ACME" }, { id: "p3", client: " acme. " }], []);
    assert.equal(plan.create.length, 1);
    assert.deepEqual(plan.create[0].projectIds.sort(), ["p1", "p2", "p3"]);
    assert.equal(plan.create[0].spellings.length, 3);
  });
  await t("migration: names differing by a legal suffix are NOT merged, they go to review", () => {
    const plan = planClientMigration([{ id: "p1", client: "Acme Pvt Ltd" }, { id: "p2", client: "Acme" }], []);
    assert.equal(plan.create.length, 2);
    assert.equal(plan.review.length, 1);
    assert.match(plan.review[0].reasons[0], /legal suffix/);
  });
  await t("migration: near-identical spellings are flagged, unrelated names are not", () => {
    const plan = planClientMigration([{ id: "1", client: "Pivura Foods" }, { id: "2", client: "Pivura Food" }, { id: "3", client: "Kaicho" }], []);
    assert.equal(plan.create.length, 3);
    assert.equal(plan.review.length, 1);
  });
  await t("migration: an exact match with an existing client links, a similar one is reviewed", () => {
    const plan = planClientMigration([{ id: "1", client: "Kaicho" }, { id: "2", client: "Zenith Labs Pvt Ltd" }], [{ id: "c1", name: "kaicho" }, { id: "c2", name: "Zenith Labs" }]);
    assert.deepEqual(plan.linkExisting.map((l) => [l.existingClientId, l.projectIds]), [["c1", ["1"]]]);
    assert.equal(plan.create.length, 1);
    assert.equal(plan.review.length, 1);
    assert.equal(plan.review[0].b.existingClientId, "c2");
  });
  await t("migration: placeholders and empty values are skipped and reported", () => {
    const plan = planClientMigration([{ id: "1", client: "N/A" }, { id: "2", client: "-" }, { id: "3", client: "" }, { id: "4", client: undefined }, { id: "5", client: "Real Co" }], []);
    assert.equal(plan.create.length, 1);
    assert.equal(plan.skippedPlaceholder.length, 2);
    assert.equal(plan.skippedEmpty, 2);
    assert.ok(isPlaceholder("TBD") && isPlaceholder("???") && !isPlaceholder("Acme"));
  });
  await t("migration: idempotent. Once projects are linked a re-plan has nothing to do", () => {
    const first = planClientMigration([{ id: "1", client: "Acme" }, { id: "2", client: "Acme Pvt Ltd" }], []);
    assert.equal(first.create.length, 2);
    const linked = [{ id: "1", client: "Acme", clientRef: "c1" }, { id: "2", client: "Acme Pvt Ltd", clientRef: "c2" }];
    const again = planClientMigration(linked, [{ id: "c1", name: "Acme", migrated: true }, { id: "c2", name: "Acme Pvt Ltd", migrated: true }]);
    assert.equal(again.create.length, 0);
    assert.equal(again.linkExisting.length, 0);
    assert.equal(again.alreadyLinked, 2);
    assert.equal(again.review.length, 1, "pair among migrated clients is re-detected so an interrupted run can finish its queue");
  });

  await t("client history is append-only: every Mongoose update and delete throws", async () => {
    const attempts: [string, () => Promise<unknown>][] = [
      ["updateOne", () => ClientHistory.updateOne({}, { $set: { summary: "x" } }).exec()],
      ["updateMany", () => ClientHistory.updateMany({}, { $set: { summary: "x" } }).exec()],
      ["findOneAndUpdate", () => ClientHistory.findOneAndUpdate({}, { $set: { summary: "x" } }).exec()],
      ["deleteOne", () => ClientHistory.deleteOne({}).exec()],
      ["deleteMany", () => ClientHistory.deleteMany({}).exec()],
      ["findOneAndDelete", () => ClientHistory.findOneAndDelete({}).exec()],
      ["replaceOne", () => ClientHistory.replaceOne({}, { client: "x" }).exec()],
    ];
    for (const [name, run] of attempts) await assert.rejects(run, /append-only/, name);
    const doc = new ClientHistory({ client: "65f000000000000000000001", action: "CREATED" });
    doc.isNew = false;
    await assert.rejects(doc.save(), /append-only/, "save of an existing document");
  });

  console.log(`\n${n} client rule checks passed.`);
}
main().catch((e) => { console.error(e); process.exit(1); });

/** Local integration checks for client management. No real accounts or credentials are used. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import nextEnv from "@next/env";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

nextEnv.loadEnvConfig(process.cwd());
const base = process.env.TEST_APP_URL || "http://localhost:3000";
const local = (value) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
if (process.env.NODE_ENV === "production" || !local(base) || !local(process.env.MONGODB_URI)) throw new Error("Use a local development app and database.");
const tag = `CLI-${randomBytes(4).toString("hex").toUpperCase()}`;
const password = `CheckA1!${randomBytes(16).toString("hex")}`;
const oid = (id) => (id ? new mongoose.Types.ObjectId(id) : new mongoose.Types.ObjectId());
const userIds = [];
const actors = {};
const ids = { dept: oid(), projects: [] };
let db;
let checks = 0;
async function check(label, run) { await run(); checks++; console.log(`PASS ${label}`); }
function expect(result, status = 200) { assert.equal(result.status, status, JSON.stringify(result.data)); return result.data; }
async function login(email) {
  const jar = new Map();
  const save = (r) => r.headers.getSetCookie().forEach((v) => { const pair = v.split(";", 1)[0]; const i = pair.indexOf("="); jar.set(pair.slice(0, i), pair.slice(i + 1)); });
  const cookies = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const csrf = await fetch(`${base}/api/auth/csrf`); save(csrf);
  const { csrfToken } = await csrf.json();
  const response = await fetch(`${base}/api/auth/callback/credentials`, { method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1", Cookie: cookies() },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: `${base}/clients` }) });
  save(response);
  const session = await (await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookies() } })).json();
  assert.ok(session.user?.id, "Fixture login failed");
  return cookies();
}
async function api(actor, path, method = "GET", body) {
  const response = await fetch(`${base}/api${path}`, { method, headers: { Cookie: actor.cookie, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json().catch(() => null) };
}
const email = (k) => `${tag}-${k}@example.com`.toLowerCase();
let phoneSeq = 0;
const phone = () => `+91 9${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}${++phoneSeq % 10}`;
const body = (extra = {}) => ({ name: `${tag} Acme`, contactPerson: "Asha Rao", email: email("main"), phone: "+91 98765 43210", ...extra });
const GSTIN = "27AAPFU0939F1ZV";
/** Distinct company names: sharing the run tag would trigger the (correct) similar-name warning. */
const u = (w) => `${w}${randomBytes(3).toString("hex")}`;
const history = async (id) => (await db.collection("clienthistories").find({ client: oid(id) }).sort({ createdAt: 1 }).toArray());
const keys = (o) => Object.keys(o).sort();

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 }); db = mongoose.connection.db;
    const roles = new Map((await db.collection("roles").find({}).toArray()).map((r) => [r.key, r._id]));
    assert.ok(roles.get("SALES_EXECUTIVE"), "Run `npm run seed` to sync roles first");
    const hash = await bcrypt.hash(password, 12);
    const fixtures = { admin: "SUPER_ADMIN", salesA: "SALES_EXECUTIVE", salesB: "SALES_EXECUTIVE", pm: "PROJECT_MANAGER", pmOther: "PROJECT_MANAGER", dh: "DEPARTMENT_HEAD", worker: "EMPLOYEE", stranger: "EMPLOYEE" };
    for (const [key, role] of Object.entries(fixtures)) {
      const _id = oid(); userIds.push(_id);
      await db.collection("users").insertOne({ _id, name: `${tag} ${key}`, email: email(key), employeeId: `${tag}-${key}`, passwordHash: hash, role: roles.get(role), department: ["dh", "worker"].includes(key) ? ids.dept : null, status: "ACTIVE", sessionVersion: 0 });
      actors[key] = { _id, id: String(_id), cookie: await login(email(key)) };
    }
    await db.collection("departments").insertOne({ _id: ids.dept, name: `${tag} Dept`, code: tag.slice(-8), status: "ACTIVE", head: actors.dh._id, teamLeaders: [], projectManagers: [], color: "#16a34a" });

    let acme; // Sales A's client
    await check("Sales Executive creates a client: owner is themself, code generated, creator recorded, history written", async () => {
      acme = expect(await api(actors.salesA, "/clients", "POST", body({ gst: { gstin: GSTIN, legalName: "Acme Pvt Ltd" }, defaultCurrency: "USD" })), 201);
      assert.match(acme.clientCode, /^CLT-\d{5}$/);
      assert.equal(acme.salesOwner.id, actors.salesA.id);
      assert.equal(acme.createdBy.id, actors.salesA.id);
      assert.equal(acme.gst.stateCode, "27"); assert.equal(acme.gst.stateName, "Maharashtra");
      assert.equal(acme.defaultCurrency, "USD");
      const h = await history(acme.id);
      assert.deepEqual(h.map((x) => x.action), ["CREATED"]);
      assert.equal(String(h[0].actor), actors.salesA.id);
      const defaults = expect(await api(actors.salesA, "/clients", "POST", body({ name: u("Zeta"), email: email("zeta"), phone: phone() })), 201);
      assert.equal(defaults.defaultCurrency, "INR", "INR is the default currency");
    });
    await check("Admins are notified when a Sales Executive creates a client", async () => {
      const n = await db.collection("notifications").find({ recipient: actors.admin._id, entityId: oid(acme.id), type: "CLIENT" }).toArray();
      assert.equal(n.length, 1);
    });
    await check("Sales cannot assign another owner on create; Admin can", async () => {
      expect(await api(actors.salesA, "/clients", "POST", body({ name: u("Own"), email: email("own"), phone: phone(), salesOwner: actors.salesB.id })), 403);
      const c = expect(await api(actors.admin, "/clients", "POST", body({ name: u("Adminmade"), email: email("am"), phone: phone(), salesOwner: actors.salesB.id })), 201);
      assert.equal(c.salesOwner.id, actors.salesB.id);
      expect(await api(actors.admin, "/clients", "POST", body({ name: u("Badowner"), email: email("bo"), phone: phone(), salesOwner: actors.worker.id })), 422);
    });
    await check("Validation: contact needed, bad email/phone, GSTIN format and checksum, GST optional", async () => {
      const r = (extra) => api(actors.salesA, "/clients", "POST", body({ name: u("Vee"), email: email(randomBytes(3).toString("hex")), phone: phone(), ...extra }));
      expect(await api(actors.salesA, "/clients", "POST", { name: `${tag} NoContact`, contactPerson: "X Y" }), 422);
      expect(await r({ email: "not-an-email" }), 422);
      expect(await r({ phone: "12" }), 422);
      const badFormat = expect(await r({ gst: { gstin: "NOTAGSTIN" } }), 422);
      assert.ok(badFormat.fieldErrors["gst.gstin"]);
      const badSum = expect(await r({ gst: { gstin: "27AAPFU0939F1ZX" } }), 422);
      assert.match(badSum.fieldErrors["gst.gstin"], /check digit/);
      expect(await r({ gst: { gstin: "" } }), 201);
      expect(await r({ website: "javascript:alert(1)" }), 422);
    });

    await check("HARD BLOCK: same email AND phone is refused for Sales, with limited info about the existing client", async () => {
      const r = await api(actors.salesB, "/clients", "POST", body({ name: `${tag} Different Name`, email: email("MAIN").toUpperCase(), phone: "09876543210" }));
      const d = expect(r, 409);
      assert.equal(d.code, "DUPLICATE_BLOCK"); assert.equal(d.canOverride, false);
      assert.equal(d.duplicates[0].id, acme.id); assert.equal(d.duplicates[0].level, "BLOCK");
      assert.deepEqual(d.duplicates[0].matched.sort(), ["email", "phone"]);
      assert.equal(d.duplicates[0].canOpen, false, "another Sales Executive cannot open it");
      for (const k of ["email", "phone", "gst", "notes"]) assert.ok(!(k in d.duplicates[0]), `${k} leaked in a duplicate warning`);
      expect(await api(actors.salesB, "/clients", "POST", body({ name: `${tag} Different Name`, phone: "9876543210", acknowledgeDuplicates: true, duplicateOverrideReason: "I really want this one anyway" })), 409);
    });
    await check("SOFT WARNING: same email alone, same phone alone, or a similar name need acknowledgement", async () => {
      const sameEmail = expect(await api(actors.salesB, "/clients", "POST", body({ name: `${tag} Other 1`, phone: phone() })), 409);
      assert.equal(sameEmail.code, "DUPLICATE_WARNING"); assert.deepEqual(sameEmail.duplicates[0].matched, ["email"]);
      const samePhone = expect(await api(actors.salesB, "/clients", "POST", body({ name: `${tag} Other 2`, email: email("p2") })), 409);
      assert.equal(samePhone.code, "DUPLICATE_WARNING"); assert.deepEqual(samePhone.duplicates[0].matched, ["phone"]);
      const similar = expect(await api(actors.salesB, "/clients", "POST", { name: `${tag} Acme Pvt Ltd`, contactPerson: "Quinn Lee", email: email("sim"), phone: phone() }), 409);
      assert.equal(similar.code, "DUPLICATE_WARNING"); assert.deepEqual(similar.duplicates[0].matched, ["name"]);
    });
    let warned;
    await check("Acknowledging a warning creates the client, records it, and queues an OPEN review (no auto-merge)", async () => {
      warned = expect(await api(actors.salesB, "/clients", "POST", body({ name: `${tag} Other 1`, phone: phone(), acknowledgeDuplicates: true })), 201);
      assert.notEqual(warned.id, acme.id);
      assert.ok((await history(warned.id)).some((h) => h.action === "DUPLICATE_ACKNOWLEDGED"));
      const review = await db.collection("duplicatereviews").findOne({ clientA: oid(warned.id), clientB: oid(acme.id) });
      assert.equal(review.status, "OPEN"); assert.equal(review.source, "CREATE_WARNING");
      assert.equal((await api(actors.salesA, `/clients/${acme.id}`)).data.name, acme.name, "the original is unchanged");
    });
    await check("Phone formats are compared by digits (+91, 0 prefix, spaces)", async () => {
      const r = await api(actors.salesB, "/clients", "POST", body({ name: `${tag} Fmt`, email: email("fmt"), phone: "+91-98765 43210" }));
      assert.equal(expect(r, 409).duplicates.some((d) => d.matched.includes("phone")), true);
    });
    await check("The check-duplicates endpoint warns while typing and is limited to client editors", async () => {
      const d = expect(await api(actors.salesB, "/clients/check-duplicates", "POST", { name: `${tag} Acme`, email: email("main"), phone: "9876543210" }));
      assert.equal(d.blocked, true);
      expect(await api(actors.worker, "/clients/check-duplicates", "POST", { name: `${tag} Acme` }), 403);
    });
    let forced;
    await check("ADMIN OVERRIDE: needs a reason of 10+ characters, is audited, and queues a review", async () => {
      const dup = body({ name: `${tag} Acme Twin` });
      const refused = expect(await api(actors.admin, "/clients", "POST", dup), 409);
      assert.equal(refused.canOverride, true);
      expect(await api(actors.admin, "/clients", "POST", { ...dup, duplicateOverrideReason: "too short" }), 409);
      forced = expect(await api(actors.admin, "/clients", "POST", { ...dup, duplicateOverrideReason: "Separate legal entity, same finance contact" }), 201);
      const h = await history(forced.id);
      const o = h.find((x) => x.action === "DUPLICATE_OVERRIDE");
      assert.equal(o.reason, "Separate legal entity, same finance contact");
      assert.equal(String(o.actor), actors.admin.id);
      const review = await db.collection("duplicatereviews").findOne({ clientA: oid(forced.id), clientB: oid(acme.id) });
      assert.equal(review.source, "CREATE_OVERRIDE"); assert.equal(review.status, "OPEN");
      assert.ok(await db.collection("auditlogs").findOne({ action: "client.duplicate_override", entityId: oid(forced.id) }));
      assert.equal(await db.collection("clients").countDocuments({ normEmail: email("main"), normPhone: "9876543210" }), 2);
    });
    await check("Two simultaneous identical creates: exactly one wins, the other gets the block", async () => {
      const dup = body({ name: u("Race"), email: email("race"), phone: phone() });
      const [a, b] = await Promise.all([api(actors.salesA, "/clients", "POST", dup), api(actors.salesB, "/clients", "POST", dup)]);
      assert.deepEqual([a.status, b.status].sort(), [201, 409]);
      assert.equal([a, b].find((x) => x.status === 409).data.code, "DUPLICATE_BLOCK");
    });

    await check("Visibility: another Sales Executive and unrelated staff cannot see or change the client (404)", async () => {
      for (const who of ["salesB", "stranger", "worker", "pmOther", "dh"]) {
        assert.equal((await api(actors[who], `/clients/${acme.id}`)).status, 404, who);
      }
      expect(await api(actors.salesB, `/clients/${acme.id}`, "PATCH", { name: "Hijacked" }), 404);
      const mine = expect(await api(actors.salesA, "/clients?pageSize=100"));
      assert.ok(mine.items.every((c) => c.salesOwner.id === actors.salesA.id));
      assert.ok(!mine.items.some((c) => c.id === warned.id));
      const all = expect(await api(actors.admin, "/clients?pageSize=100&q=" + tag));
      assert.ok([acme.id, warned.id, forced.id].every((id) => all.items.some((c) => c.id === id)));
    });

    let p1, p2;
    await check("One client, many projects: projects link by clientRef", async () => {
      const mk = async (n, extra = {}) => { const _id = oid(); ids.projects.push(_id); await db.collection("projects").insertOne({ _id, code: `${tag}-P${n}`, name: `${tag} Project ${n}`, client: "legacy text", clientRef: oid(acme.id), status: "ACTIVE", priority: "MEDIUM", departments: [ids.dept], manager: actors.pm._id, isArchived: false, progress: 0, createdAt: new Date(), updatedAt: new Date(), ...extra }); return String(_id); };
      p1 = await mk(1); p2 = await mk(2);
      await db.collection("projectmembers").insertOne({ project: oid(p1), user: actors.worker._id, department: ids.dept, projectRole: "MEMBER", isActive: true, joinedAt: new Date() });
      await db.collection("projectmembers").insertOne({ project: oid(p1), user: actors.pm._id, department: ids.dept, projectRole: "MANAGER", isActive: true, joinedAt: new Date() });
      const detail = expect(await api(actors.salesA, `/clients/${acme.id}`));
      assert.equal(detail.projectCount, 2);
      const list = expect(await api(actors.salesA, `/clients/${acme.id}/projects`));
      assert.deepEqual(list.map((p) => p.id).sort(), [p1, p2].sort());
      assert.ok(list.every((p) => !("budget" in p)));
    });
    await check("Project Manager of the client's project: full view incl. GST/billing, history and contacts", async () => {
      const c = expect(await api(actors.pm, `/clients/${acme.id}`));
      assert.equal(c.viewLevel, "FULL"); assert.equal(c.gst.gstin, GSTIN); assert.equal(c.email, email("main"));
      expect(await api(actors.pm, `/clients/${acme.id}/history`)); expect(await api(actors.pm, `/clients/${acme.id}/contacts`));
      assert.equal((await api(actors.pmOther, `/clients/${acme.id}`)).status, 404, "PM of other projects");
      assert.ok((await api(actors.pm, `/clients?q=${tag}`)).data.items.some((x) => x.id === acme.id));
    });
    await check("Department Head: limited read-only view with no contact data, GST, billing, notes or history", async () => {
      await db.collection("projectmembers").insertOne({ project: oid(p1), user: actors.dh._id, department: ids.dept, projectRole: "MEMBER", isActive: true, joinedAt: new Date() });
      const c = expect(await api(actors.dh, `/clients/${acme.id}`));
      assert.equal(c.viewLevel, "LIMITED");
      assert.deepEqual(keys(c).filter((k) => ["email", "phone", "gst", "billingAddress", "notes", "businessAddress", "defaultCurrency", "createdBy"].includes(k)), []);
      assert.equal(c.contactPerson, "Asha Rao");
      expect(await api(actors.dh, `/clients/${acme.id}/history`), 403);
      expect(await api(actors.dh, `/clients/${acme.id}/contacts`), 403);
      expect(await api(actors.dh, `/clients/${acme.id}`, "PATCH", { notes: "x" }), 403);
      assert.equal((await api(actors.dh, "/clients", "POST", body())).status, 403);
      const probe = expect(await api(actors.dh, `/clients?q=${encodeURIComponent(email("main"))}`));
      assert.equal(probe.items.length, 0, "search must not match on fields the viewer cannot see");
    });
    await check("Employee on the project: minimal view (name, category, website only)", async () => {
      const c = expect(await api(actors.worker, `/clients/${acme.id}`));
      assert.equal(c.viewLevel, "MINIMAL");
      assert.deepEqual(keys(c).filter((k) => ["contactPerson", "salesOwner", "email", "phone", "gst", "notes"].includes(k)), []);
      expect(await api(actors.worker, `/clients/${acme.id}/history`), 403);
      assert.equal((await api(actors.stranger, `/clients/${acme.id}`)).status, 404);
      expect(await api(actors.worker, `/clients/${acme.id}`, "PATCH", { name: "x" }), 403);
    });
    await check("Employee with only a task on the project also gets the minimal view", async () => {
      await db.collection("tasks").insertOne({ _id: oid(), taskNumber: `${tag}-T1`, title: "t", project: oid(p2), status: "TODO", priority: "MEDIUM", owner: actors.stranger._id, createdBy: actors.pm._id, collaborators: [], dependencies: [], checklist: [], timeLog: [], createdAt: new Date(), updatedAt: new Date() });
      assert.equal(expect(await api(actors.stranger, `/clients/${acme.id}`)).viewLevel, "MINIMAL");
    });

    await check("Editing records field-level history, updater and timestamps; unchanged saves write nothing", async () => {
      const before = (await history(acme.id)).length;
      expect(await api(actors.salesA, `/clients/${acme.id}`, "PATCH", { name: acme.name }));
      assert.equal((await history(acme.id)).length, before, "no-op edit must not create history");
      const r = expect(await api(actors.salesA, `/clients/${acme.id}`, "PATCH", { contactPerson: "Meera Nair", website: "acme-example.com", notes: "Prefers WhatsApp" }));
      assert.equal(r.updatedBy.id, actors.salesA.id); assert.equal(r.contactPerson, "Meera Nair"); assert.equal(r.website, "https://acme-example.com");
      const h = (await history(acme.id)).at(-1);
      assert.equal(h.action, "UPDATED"); assert.deepEqual(h.changes.contactPerson, { from: "Asha Rao", to: "Meera Nair" });
      assert.deepEqual(Object.keys(h.changes).sort(), ["contactPerson", "notes", "website"]);
      acme = r;
    });
    await check("Stale edits are refused (optimistic concurrency)", async () => {
      expect(await api(actors.salesA, `/clients/${acme.id}`, "PATCH", { notes: "late", expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }), 409);
      expect(await api(actors.salesA, `/clients/${acme.id}`, "PATCH", { notes: "fresh", expectedUpdatedAt: acme.updatedAt }));
      acme = expect(await api(actors.salesA, `/clients/${acme.id}`));
    });
    await check("GST/billing edits: owner and Admin yes, PM no; values are masked in the shared audit log", async () => {
      expect(await api(actors.pm, `/clients/${acme.id}`, "PATCH", { gst: { gstin: "29AAGCB7383J1Z4" } }), 403);
      expect(await api(actors.pm, `/clients/${acme.id}`, "PATCH", { defaultCurrency: "EUR" }), 403);
      expect(await api(actors.pm, `/clients/${acme.id}`, "PATCH", { billingAddress: { line1: "x", country: "India" } }), 403);
      expect(await api(actors.salesA, `/clients/${acme.id}`, "PATCH", { gst: { gstin: "27AAPFU0939F1ZX" } }), 422);
      const r = expect(await api(actors.salesA, `/clients/${acme.id}`, "PATCH", { gst: { gstin: "29AAGCB7383J1Z4", legalName: "Acme Pvt Ltd" }, billingSameAsBusiness: false, billingAddress: { line1: "12 MG Road", city: "Bengaluru", country: "India" } }));
      assert.equal(r.gst.stateCode, "29");
      const h = (await history(acme.id)).at(-1);
      assert.deepEqual(h.changes["gst.gstin"], { from: GSTIN, to: "29AAGCB7383J1Z4" }, "full values stay in the restricted history");
      const a = await db.collection("auditlogs").find({ entityId: oid(acme.id), action: "client.updated" }).sort({ createdAt: -1 }).limit(1).next();
      assert.deepEqual(a.changes["gst.gstin"], { from: "[restricted]", to: "[restricted]" });
      acme = r;
    });
    await check("PM can edit ordinary client data on their project's client; cannot reassign owner or change status", async () => {
      const r = expect(await api(actors.pm, `/clients/${acme.id}`, "PATCH", { alternateContact: { name: "Ravi", email: email("alt"), phone: "" }, businessCategory: "Retail & E-commerce" }));
      assert.equal(r.alternateContact.name, "Ravi");
      expect(await api(actors.pm, `/clients/${acme.id}`, "PATCH", { salesOwner: actors.salesB.id }), 403);
      expect(await api(actors.pm, `/clients/${acme.id}`, "PATCH", { status: "INACTIVE" }), 403);
      assert.equal(String((await history(acme.id)).at(-1).actor), actors.pm.id);
    });
    await check("Owner reassignment: Admin only, recorded, both people notified", async () => {
      expect(await api(actors.salesA, `/clients/${acme.id}`, "PATCH", { salesOwner: actors.salesB.id }), 403);
      const r = expect(await api(actors.admin, `/clients/${acme.id}`, "PATCH", { salesOwner: actors.salesB.id }));
      assert.equal(r.salesOwner.id, actors.salesB.id);
      const h = (await history(acme.id)).at(-1);
      assert.equal(h.action, "OWNER_CHANGED"); assert.match(h.summary, /changed from .* to /);
      const n = await db.collection("notifications").find({ entityId: oid(acme.id), title: "Client ownership changed" }).toArray();
      assert.deepEqual(n.map((x) => String(x.recipient)).sort(), [actors.salesA.id, actors.salesB.id].sort());
      assert.equal((await api(actors.salesA, `/clients/${acme.id}`)).status, 404, "previous owner loses access");
      assert.equal(expect(await api(actors.salesB, `/clients/${acme.id}`)).viewLevel, "FULL");
      expect(await api(actors.admin, `/clients/${acme.id}`, "PATCH", { salesOwner: actors.salesA.id }));
    });

    await check("Multiple contacts: add, list, edit, remove with history; non-editors refused", async () => {
      const c = expect(await api(actors.salesA, `/clients/${acme.id}/contacts`, "POST", { name: "Finance Lead", designation: "CFO", email: email("cfo"), phone: "" }), 201);
      expect(await api(actors.salesA, `/clients/${acme.id}/contacts`, "POST", { name: "Ops Lead", email: email("ops") }), 201);
      assert.equal(expect(await api(actors.salesA, `/clients/${acme.id}/contacts`)).length, 2);
      const u = expect(await api(actors.salesA, `/clients/${acme.id}/contacts/${c.id}`, "PATCH", { designation: "Finance Director" }));
      assert.equal(u.designation, "Finance Director");
      expect(await api(actors.worker, `/clients/${acme.id}/contacts`, "POST", { name: "Nope Nope" }), 403);
      expect(await api(actors.salesB, `/clients/${acme.id}/contacts`, "POST", { name: "Nope Nope" }), 404);
      expect(await api(actors.salesA, `/clients/${acme.id}/contacts/${c.id}`, "DELETE"));
      assert.equal(expect(await api(actors.salesA, `/clients/${acme.id}/contacts`)).length, 1);
      assert.deepEqual((await history(acme.id)).filter((h) => h.action.startsWith("CONTACT")).map((h) => h.action), ["CONTACT_ADDED", "CONTACT_ADDED", "CONTACT_UPDATED", "CONTACT_REMOVED"]);
      assert.equal(await db.collection("clientcontacts").countDocuments({ client: oid(acme.id), isActive: false }), 1, "removed contact is kept, hidden");
    });
    await check("History endpoint is paginated, newest first, and cannot be written through the API", async () => {
      const page = expect(await api(actors.salesA, `/clients/${acme.id}/history?pageSize=3`));
      assert.equal(page.items.length, 3); assert.ok(page.total > 3);
      assert.ok(new Date(page.items[0].createdAt) >= new Date(page.items[1].createdAt));
      for (const m of ["POST", "PATCH", "DELETE", "PUT"]) assert.equal((await api(actors.admin, `/clients/${acme.id}/history`, m, {})).status, 405, m);
    });

    await check("Archiving is Admin-only; archived clients leave lists and release their duplicate lock", async () => {
      const soloName = u("Solo");
      const solo = expect(await api(actors.salesA, "/clients", "POST", body({ name: soloName, email: email("solo"), phone: "+91 90000 11111" })), 201);
      expect(await api(actors.salesA, `/clients/${solo.id}`, "PATCH", { status: "ARCHIVED" }), 403);
      expect(await api(actors.salesA, `/clients/${solo.id}`, "PATCH", { status: "INACTIVE" }));
      expect(await api(actors.admin, `/clients/${solo.id}`, "PATCH", { status: "ARCHIVED" }));
      assert.ok(!(await api(actors.salesA, `/clients?q=${soloName}`)).data.items.length, "hidden from the owner's list");
      assert.ok((await api(actors.admin, `/clients?status=ARCHIVED&q=${soloName}`)).data.items.length);
      assert.equal((await db.collection("clients").findOne({ _id: oid(solo.id) })).dedupeKey, undefined);
      const again = expect(await api(actors.salesA, "/clients", "POST", body({ name: soloName, email: email("solo"), phone: "+91 90000 11111" })), 409);
      assert.equal(again.code, "DUPLICATE_WARNING", "an archived duplicate warns but does not block");
      expect(await api(actors.admin, `/clients/${solo.id}`, "PATCH", { status: "ACTIVE" }));
    });

    await check("Duplicate review queue: Admin only, requires a note, resolves once, never merges", async () => {
      expect(await api(actors.salesA, "/clients/duplicate-reviews"), 403);
      const q = expect(await api(actors.admin, "/clients/duplicate-reviews?pageSize=100"));
      const mine = q.items.filter((r) => [r.clientA?.id, r.clientB?.id].some((id) => [warned.id, forced.id].includes(id)));
      assert.ok(mine.length >= 2); assert.ok(mine.every((r) => r.status === "OPEN"));
      expect(await api(actors.admin, `/clients/duplicate-reviews/${mine[0].id}`, "PATCH", { decision: "NOT_DUPLICATE", note: "" }), 422);
      expect(await api(actors.salesA, `/clients/duplicate-reviews/${mine[0].id}`, "PATCH", { decision: "NOT_DUPLICATE", note: "sneaky" }), 403);
      expect(await api(actors.admin, `/clients/duplicate-reviews/${mine[0].id}`, "PATCH", { decision: "NOT_DUPLICATE", note: "Different companies, shared accountant" }));
      expect(await api(actors.admin, `/clients/duplicate-reviews/${mine[0].id}`, "PATCH", { decision: "CONFIRMED_DUPLICATE", note: "second thoughts" }), 409);
      const r = (await api(actors.admin, "/clients/duplicate-reviews?status=NOT_DUPLICATE&pageSize=100")).data.items.find((x) => x.id === mine[0].id);
      assert.equal(r.resolvedBy.id, actors.admin.id);
      assert.equal(await db.collection("clients").countDocuments({ _id: { $in: [oid(warned.id), oid(acme.id)] } }), 2, "nothing merged or deleted");
    });
    await check("DB health endpoint: Admin only; reports topology and transaction support without any credentials", async () => {
      const h = expect(await api(actors.admin, "/health/db"));
      assert.ok(["standalone", "replicaSet", "sharded"].includes(h.topology)); assert.equal(typeof h.transactionsSupported, "boolean");
      const text = JSON.stringify(h);
      assert.ok(!/mongodb(\+srv)?:\/\/|password|@|127\.0\.0\.1|localhost/i.test(text), "health output must not expose connection details");
      expect(await api(actors.salesA, "/health/db"), 403);
    });
    await check("Pages render for permitted roles and are gated for the rest", async () => {
      const page = (actor, path) => fetch(`${base}${path}`, { headers: { Cookie: actor.cookie }, redirect: "manual" });
      for (const [who, path] of [["salesA", "/clients"], ["admin", "/clients"], ["pm", "/clients"], ["worker", "/clients"], ["salesA", `/clients/${acme.id}`], ["admin", "/clients/duplicate-reviews"]]) {
        const r = await page(actors[who], path);
        assert.equal(r.status, 200, `${who} ${path}`);
        assert.match(await r.text(), /<title>[^<]*(Clients|Client|Duplicate reviews)/, `${who} ${path} title`);
      }
      const denied = await page(actors.salesA, "/clients/duplicate-reviews");
      // The dashboard layout streams, so Next delivers redirect() as a 200 carrying a redirect to /forbidden.
      const deniedHtml = await denied.text();
      assert.ok(/NEXT_REDIRECT[^"]*forbidden/.test(deniedHtml) || /forbidden/.test(denied.headers.get("location") ?? ""), "Sales is sent to the forbidden page");
      assert.ok(!/Record decision|Nothing to review/.test(deniedHtml), "no duplicate-review content leaks to Sales");
      const missing = await page(actors.salesA, "/clients/not-an-id");
      assert.ok(missing.status === 404 || /NEXT_HTTP_ERROR_FALLBACK;404|could not be found/i.test(await missing.text()), "malformed ids show not-found");
      const nav = await (await page(actors.salesA, "/dashboard")).text();
      assert.match(nav, /href="\/clients"/, "Sales sees the Clients menu entry");
    });
    await check("Legacy project API and Sales role boundaries still hold", async () => {
      expect(await api(actors.pm, "/projects"));
      assert.equal((await api(actors.salesA, "/tickets")).status, 403, "Sales has no ticket access");
      assert.equal((await api(actors.salesA, "/employees")).status, 403, "Sales cannot read the employee directory");
      assert.equal((await api(actors.salesA, "/audit-logs")).status, 403);
    });
    console.log(`${checks} client integration checks passed.`);
  } finally {
    if (db) {
      const clients = await db.collection("clients").find({ $or: [{ createdBy: { $in: userIds } }, { name: new RegExp(`^${tag}`) }] }).project({ _id: 1 }).toArray();
      const cids = clients.map((c) => c._id);
      await db.collection("clienthistories").deleteMany({ client: { $in: cids } });
      await db.collection("clientcontacts").deleteMany({ client: { $in: cids } });
      await db.collection("duplicatereviews").deleteMany({ $or: [{ clientA: { $in: cids } }, { clientB: { $in: cids } }] });
      await db.collection("notifications").deleteMany({ $or: [{ actor: { $in: userIds } }, { recipient: { $in: userIds } }, { entityId: { $in: cids } }] });
      await db.collection("auditlogs").deleteMany({ $or: [{ actor: { $in: userIds } }, { entityId: { $in: cids } }] });
      await db.collection("tasks").deleteMany({ project: { $in: ids.projects } });
      await db.collection("projectmembers").deleteMany({ project: { $in: ids.projects } });
      await db.collection("projects").deleteMany({ _id: { $in: ids.projects } });
      await db.collection("clients").deleteMany({ _id: { $in: cids } });
      await db.collection("users").deleteMany({ _id: { $in: userIds } });
      await db.collection("departments").deleteMany({ _id: ids.dept });
      console.log("Temporary client test records removed.");
    }
    await mongoose.disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

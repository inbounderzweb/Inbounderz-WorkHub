/** Local integration checks for service requirements, project handover and PM acceptance. No real accounts or credentials are used. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import nextEnv from "@next/env";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

nextEnv.loadEnvConfig(process.cwd());
const base = process.env.TEST_APP_URL || "http://localhost:3000";
const local = (value) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
if (process.env.NODE_ENV === "production" || !local(base) || !local(process.env.MONGODB_URI)) throw new Error("Use a local development app and database.");
const tag = `HOV-${randomBytes(4).toString("hex").toUpperCase()}`;
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
const u = (w) => `${w}${randomBytes(3).toString("hex")}`;
const newClient = (extra = {}) => ({ name: u("Co"), contactPerson: "Asha Rao", email: email(randomBytes(3).toString("hex")), phone: phone(), ...extra });
const smm = (extra = {}) => ({ serviceType: "SMM", status: "REQUIREMENT_COLLECTED", proposedBudget: 30000, config: { posters: 12, videos: 4, platforms: ["Instagram", "Facebook"], billingCycle: "MONTHLY" }, ...extra });
const sem = (extra = {}) => ({ serviceType: "SEM", status: "QUOTED", adSpend: 100000, agencyFee: 15000, config: { searchAds: true, campaigns: 3, targetLocations: ["Mumbai"] }, ...extra });
const quick = (extra = {}) => ({ serviceType: "QUICK_WORK", status: "INTERESTED", config: { title: "Fix the hero banner", deadline: "2030-01-01", maxHours: 6 }, ...extra });
const history = (id) => db.collection("clienthistories").find({ client: oid(id) }).sort({ createdAt: 1 }).toArray();
const project = (id) => db.collection("projects").findOne({ _id: oid(id) });
const assignments = (id) => db.collection("pmassignments").find({ project: oid(id) }).sort({ sequence: 1 }).toArray();
const handoverBody = (reqId, extra = {}) => ({
  project: { name: u("Launch "), description: "Brand launch", startDate: "2030-02-01", endDate: "2030-06-01", priority: "HIGH", currency: "INR", notes: "Rush" },
  services: [{ requirementId: reqId, confirmedScope: "12 posters and 4 reels per month for 6 months", deliverables: [{ type: "Poster", quantity: 72 }, { type: "Reel", quantity: 24, specifications: "9:16" }], approvedBudget: 30000, agencyFee: 3000, estimatedHours: 120, startDate: "2030-02-01", endDate: "2030-06-01" }],
  team: { primaryPm: actors.pm.id, supportingPms: [actors.pmSupport.id], coordinator: actors.worker.id, handoverNotes: "Client expects weekly reports", proposedHandoverDate: "2030-01-20" },
  submit: true,
  ...extra,
});
const createdProjects = [];
async function approvedReq(actor, client, extra = {}) {
  const r = expect(await api(actor, `/clients/${client.id}/requirements`, "POST", smm({ status: "APPROVED", ...extra })), 201);
  return r;
}
async function handover(actor, client, reqId, extra = {}) {
  const r = await api(actor, `/clients/${client.id}/handover`, "POST", handoverBody(reqId, extra));
  if (r.status === 201) createdProjects.push(r.data.projectId);
  return r;
}

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 }); db = mongoose.connection.db;
    const roles = new Map((await db.collection("roles").find({}).toArray()).map((r) => [r.key, r._id]));
    assert.ok(roles.get("SALES_EXECUTIVE"), "Run `npm run seed` to sync roles first");
    const hash = await bcrypt.hash(password, 12);
    const fixtures = { admin: "SUPER_ADMIN", salesA: "SALES_EXECUTIVE", salesB: "SALES_EXECUTIVE", pm: "PROJECT_MANAGER", pmOther: "PROJECT_MANAGER", pmSupport: "PROJECT_MANAGER", pmInactive: "PROJECT_MANAGER", dh: "DEPARTMENT_HEAD", worker: "EMPLOYEE", stranger: "EMPLOYEE" };
    for (const [key, role] of Object.entries(fixtures)) {
      const _id = oid(); userIds.push(_id);
      await db.collection("users").insertOne({ _id, name: `${tag} ${key}`, email: email(key), employeeId: `${tag}-${key}`, passwordHash: hash, role: roles.get(role), department: ["dh", "worker"].includes(key) ? ids.dept : null, status: key === "pmInactive" ? "INACTIVE" : "ACTIVE", sessionVersion: 0 });
      if (key !== "pmInactive") actors[key] = { _id, id: String(_id), cookie: await login(email(key)) };
      else actors[key] = { _id, id: String(_id) };
    }
    await db.collection("departments").insertOne({ _id: ids.dept, name: `${tag} Dept`, code: tag.slice(-8), status: "ACTIVE", head: actors.dh._id, teamLeaders: [], projectManagers: [], color: "#16a34a" });

    /* -------------------- Client onboarding with services -------------------- */
    let acme;
    await check("1-4. Sales creates a client with several service requirements in one step; they persist and reload", async () => {
      acme = expect(await api(actors.salesA, "/clients", "POST", newClient({ requirements: [smm(), sem(), quick()] })), 201);
      const list = expect(await api(actors.salesA, `/clients/${acme.id}/requirements`));
      assert.deepEqual(list.map((r) => r.serviceType), ["SMM", "SEM", "QUICK_WORK"]);
      assert.equal(list[0].config.posters, 12);
      assert.deepEqual(list[0].config.platforms, ["Instagram", "Facebook"]);
      assert.equal(list[0].createdBy.id, actors.salesA.id);
      const raw = await db.collection("clientservicerequirements").find({ client: oid(acme.id) }).toArray();
      assert.equal(raw.length, 3, "stored in MongoDB, not just echoed back");
      assert.equal(list[0].status, "REQUIREMENT_COLLECTED");
      assert.equal(list[1].status, "QUOTED");
    });
    await check("3. Each service stores only its own configuration, and money fields stay separate", async () => {
      const [a, b, c] = expect(await api(actors.salesA, `/clients/${acme.id}/requirements`));
      assert.equal("searchAds" in a.config, false);
      assert.equal(b.adSpend, 100000); assert.equal(b.agencyFee, 15000); assert.equal(b.proposedBudget, null);
      assert.equal(a.proposedBudget, 30000); assert.equal(a.adSpend, null);
      assert.equal(c.config.entryDate, new Date().toISOString().slice(0, 10), "entry date is automatic");
      assert.equal(c.currency, "INR");
    });
    await check("Invalid requirements are rejected on the server with field paths, and the client is not created", async () => {
      const before = await db.collection("clients").countDocuments({ createdBy: actors.salesA._id });
      const r = expect(await api(actors.salesA, "/clients", "POST", newClient({ requirements: [smm(), { serviceType: "SMM", status: "REQUIREMENT_COLLECTED", config: { posters: -3 } }, sem({ adSpend: null, agencyFee: null })] })), 422);
      assert.ok(r.fieldErrors["requirements.1.config.posters"]);
      assert.ok(r.fieldErrors["requirements.2.adSpend"]);
      expect(await api(actors.salesA, "/clients", "POST", newClient({ requirements: [{ serviceType: "NOPE" }] })), 422);
      expect(await api(actors.salesA, "/clients", "POST", newClient({ requirements: [quick({ config: { title: "" } })] })), 422);
      assert.equal(await db.collection("clients").countDocuments({ createdBy: actors.salesA._id }), before);
    });
    await check("A client can still be created without any services", async () => {
      expect(await api(actors.salesA, "/clients", "POST", newClient()), 201);
    });

    /* -------------------- Editing and adding later -------------------- */
    let extra;
    await check("6. Sales adds a requirement after creation; history records it", async () => {
      extra = expect(await api(actors.salesA, `/clients/${acme.id}/requirements`, "POST", { serviceType: "SEO", config: { websiteSeo: true, targetKeywords: "25" } }), 201);
      assert.equal(extra.status, "INTERESTED"); assert.equal(extra.config.targetKeywords, 25);
      assert.ok((await history(acme.id)).some((h) => h.action === "REQUIREMENT_ADDED" && /SEO/.test(h.summary)));
    });
    await check("5. Sales edits a requirement: config merges, status change is its own history entry", async () => {
      const r = expect(await api(actors.salesA, `/clients/${acme.id}/requirements/${extra.id}`, "PATCH", { config: { blogsPerMonth: 4 }, status: "REQUIREMENT_COLLECTED" }));
      assert.equal(r.config.blogsPerMonth, 4); assert.equal(r.config.targetKeywords, 25, "untouched values are preserved"); assert.equal(r.updatedBy.id, actors.salesA.id);
      const h = (await history(acme.id)).filter((x) => x.action === "REQUIREMENT_STATUS_CHANGED");
      assert.equal(h.length, 1); assert.equal(h[0].changes.status.to, "REQUIREMENT_COLLECTED");
      extra = r;
    });
    await check("Stale edits are refused; moving to Quoted without an amount is refused", async () => {
      expect(await api(actors.salesA, `/clients/${acme.id}/requirements/${extra.id}`, "PATCH", { config: { blogsPerMonth: 9 }, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }), 409);
      expect(await api(actors.salesA, `/clients/${acme.id}/requirements/${extra.id}`, "PATCH", { status: "QUOTED" }), 422);
      const ok = expect(await api(actors.salesA, `/clients/${acme.id}/requirements/${extra.id}`, "PATCH", { status: "QUOTED", proposedBudget: 12000, expectedUpdatedAt: extra.updatedAt }));
      assert.equal(ok.proposedBudget, 12000); extra = ok;
    });
    await check("Amounts are masked in the shared audit log but visible in the (restricted) client history", async () => {
      const audit = await db.collection("auditlogs").find({ entityId: oid(acme.id), action: "client.requirement_update" }).toArray();
      assert.ok(audit.length);
      assert.equal(JSON.stringify(audit.map((a) => a.changes)).includes("12000"), false);
      const h = (await history(acme.id)).find((x) => x.changes?.proposedBudget);
      assert.equal(h.changes.proposedBudget.to, 12000);
    });
    await check("Bulk save from the client form: update, add and remove atomically; one bad item changes nothing", async () => {
      const cur = expect(await api(actors.salesA, `/clients/${acme.id}/requirements`));
      const keep = cur.filter((r) => r.serviceType !== "QUICK_WORK").map((r) => ({ id: r.id, serviceType: r.serviceType, status: r.status, currency: r.currency, proposedBudget: r.proposedBudget, adSpend: r.adSpend, agencyFee: r.agencyFee, config: r.config }));
      const bad = expect(await api(actors.salesA, `/clients/${acme.id}/requirements`, "PUT", { requirements: [...keep, { serviceType: "VIDEO", status: "REQUIREMENT_COLLECTED", config: {} }] }), 422);
      assert.ok(Object.keys(bad.fieldErrors).some((k) => k.startsWith(`requirements.${keep.length}.config`)));
      assert.equal(expect(await api(actors.salesA, `/clients/${acme.id}/requirements`)).length, cur.length, "nothing was written");
      keep[0] = { ...keep[0], config: { ...keep[0].config, posters: 20 } };
      const saved = expect(await api(actors.salesA, `/clients/${acme.id}/requirements`, "PUT", { requirements: [...keep, { serviceType: "WEBSITE", config: { websiteType: "SHOPIFY", pages: 10 } }] }));
      assert.deepEqual(saved.map((r) => r.serviceType).sort(), ["SEM", "SEO", "SMM", "WEBSITE"].sort());
      assert.equal(saved.find((r) => r.serviceType === "SMM").config.posters, 20);
      const acts = (await history(acme.id)).map((h) => h.action);
      assert.ok(acts.includes("REQUIREMENT_REMOVED"));
      expect(await api(actors.salesA, `/clients/${acme.id}/requirements`, "PUT", { requirements: [{ id: oid().toString(), serviceType: "SMM" }] }), 422);
    });

    /* -------------------- Permissions -------------------- */
    await check("16. Requirement permissions: owner and Admin write; others cannot read or write", async () => {
      assert.equal((await api(actors.salesB, `/clients/${acme.id}/requirements`)).status, 404);
      assert.equal((await api(actors.salesB, `/clients/${acme.id}/requirements`, "POST", smm())).status, 404);
      assert.equal((await api(actors.worker, `/clients/${acme.id}/requirements`)).status === 404 || (await api(actors.worker, `/clients/${acme.id}/requirements`)).status === 403, true);
      assert.equal((await api(actors.dh, `/clients/${acme.id}/requirements`)).status === 404 || (await api(actors.dh, `/clients/${acme.id}/requirements`)).status === 403, true);
      expect(await api(actors.admin, `/clients/${acme.id}/requirements`));
      const adminAdd = expect(await api(actors.admin, `/clients/${acme.id}/requirements`, "POST", { serviceType: "VIDEO" }), 201);
      expect(await api(actors.admin, `/clients/${acme.id}/requirements/${adminAdd.id}`, "DELETE"));
    });

    /* -------------------- Handover creation -------------------- */
    let req1, h1;
    await check("Handover guards: needs approved requirements, own client, a real Project Manager", async () => {
      const quoted = (await api(actors.salesA, `/clients/${acme.id}/requirements`)).data.find((r) => r.serviceType === "SEM");
      assert.equal(quoted.status, "QUOTED");
      const unapproved = expect(await handover(actors.salesA, acme, quoted.id), 422);
      assert.ok(unapproved.fieldErrors["services.0.requirementId"]);
      const other = expect(await api(actors.salesB, "/clients", "POST", newClient()), 201);
      const foreign = await approvedReq(actors.salesB, other);
      assert.equal((await handover(actors.salesA, acme, foreign.id)).status, 422, "another client's requirement cannot be pulled in");
      assert.equal((await handover(actors.salesB, acme, foreign.id)).status, 404, "Sales B cannot start a project for Sales A's client");
      assert.equal((await handover(actors.pm, acme, foreign.id)).status, 403, "a PM cannot start a handover");
      req1 = await approvedReq(actors.salesA, acme);
      assert.equal((await handover(actors.salesA, acme, req1.id, { team: { primaryPm: actors.worker.id, supportingPms: [], handoverNotes: "" } })).status, 422);
      assert.equal((await handover(actors.salesA, acme, req1.id, { team: { primaryPm: actors.pmInactive.id, supportingPms: [], handoverNotes: "" } })).status, 422);
      assert.equal((await handover(actors.salesA, acme, req1.id, { team: { primaryPm: actors.pm.id, supportingPms: [actors.pm.id], handoverNotes: "" } })).status, 422);
      assert.equal((await handover(actors.salesA, acme, req1.id, { team: { supportingPms: [], handoverNotes: "" } })).status, 422, "submitting needs a primary PM");
      assert.equal((await handover(actors.salesA, acme, req1.id, { services: [] })).status, 422);
      const badDeliverable = await handover(actors.salesA, acme, req1.id, { services: [{ ...handoverBody(req1.id).services[0], deliverables: [{ type: "Poster", quantity: 0 }] }] });
      assert.equal(badDeliverable.status, 422);
      assert.equal(await db.collection("projects").countDocuments({ clientRef: oid(acme.id) }), 0, "no project was created by any refused attempt");
    });
    await check("8-10. Sales creates a project from an approved requirement and submits it: PM-less project, services and deliverables kept with the source requirement", async () => {
      h1 = expect(await handover(actors.salesA, acme, req1.id), 201);
      assert.equal(h1.status, "HANDOVER_PENDING"); assert.match(h1.code, /^PRJ-/);
      const p = await project(h1.projectId);
      assert.equal(p.manager, null, "nominating does not make anyone the manager");
      assert.equal(String(p.clientRef), acme.id); assert.equal(p.currency, "INR"); assert.equal(p.budget, 30000);
      const [svc] = await db.collection("projectservices").find({ project: oid(h1.projectId) }).toArray();
      assert.equal(String(svc.requirement), req1.id); assert.equal(svc.deliverables.length, 2); assert.equal(svc.deliverables[0].completedQuantity, 0);
      assert.equal(svc.requirementSnapshot.config.posters, 12); assert.equal(svc.requirementSnapshot.status, "APPROVED");
      assert.equal(svc.approvedBudget, 30000); assert.equal(svc.agencyFee, 3000); assert.equal(svc.estimatedHours, 120);
      const [a] = await assignments(h1.projectId);
      assert.equal(a.status, "PENDING"); assert.equal(String(a.primaryPm), actors.pm.id); assert.equal(a.supportingPms.length, 1); assert.equal(String(a.coordinator), actors.worker.id);
      assert.ok((await history(acme.id)).some((h) => h.action === "PROJECT_HANDOVER"));
      const untouched = (await api(actors.salesA, `/clients/${acme.id}/requirements`)).data.find((r) => r.id === req1.id);
      assert.equal(untouched.config.posters, 12, "the original requirement is intact");
      assert.equal(untouched.linkedProject.id, h1.projectId);
    });
    await check("Only selected approved requirements convert: the other requirements stay requirements", async () => {
      assert.equal(await db.collection("projectservices").countDocuments({ client: oid(acme.id) }), 1);
      assert.equal(await db.collection("projects").countDocuments({ clientRef: oid(acme.id) }), 1);
    });
    await check("A converted requirement is locked and cannot back a second project", async () => {
      expect(await api(actors.salesA, `/clients/${acme.id}/requirements/${req1.id}`, "PATCH", { config: { posters: 1 } }), 409);
      expect(await api(actors.salesA, `/clients/${acme.id}/requirements/${req1.id}`, "DELETE"), 409);
      const again = await handover(actors.salesA, acme, req1.id);
      assert.equal(again.status, 422); assert.match(again.data.fieldErrors["services.0.requirementId"], /already part of a project/);
    });
    await check("11. The nominated PM and the team are notified; the Sales owner and Admin are not spammed", async () => {
      const pmNote = await db.collection("notifications").find({ recipient: actors.pm._id, entityId: oid(h1.projectId) }).toArray();
      assert.equal(pmNote.length, 1); assert.match(pmNote[0].title, /awaiting your response/); assert.equal(pmNote[0].type, "PROJECT");
      assert.equal(await db.collection("notifications").countDocuments({ recipient: actors.pmSupport._id, entityId: oid(h1.projectId) }), 1);
      assert.equal(await db.collection("notifications").countDocuments({ recipient: actors.pmOther._id, entityId: oid(h1.projectId) }), 0);
    });

    /* -------------------- Visibility -------------------- */
    await check("Who can open a pending handover: owner, Admin and the nominated people only", async () => {
      for (const who of ["salesA", "admin", "pm", "pmSupport", "worker"]) assert.equal((await api(actors[who], `/projects/${h1.projectId}`)).status, 200, who);
      for (const who of ["salesB", "pmOther", "dh", "stranger"]) assert.equal((await api(actors[who], `/projects/${h1.projectId}`)).status, 404, who);
    });
    await check("Financial detail follows access: PM and Sales see amounts; the coordinator does not", async () => {
      const pm = expect(await api(actors.pm, `/projects/${h1.projectId}`));
      assert.equal(pm.services[0].approvedBudget, 30000); assert.equal(pm.services[0].agencyFee, 3000);
      assert.equal(pm.handover.status, "PENDING"); assert.equal(pm.handover.can.respond, true); assert.equal(pm.manager, null);
      assert.equal(pm.clientRef.id, acme.id);
      const co = expect(await api(actors.worker, `/projects/${h1.projectId}`));
      assert.equal(co.services[0].approvedBudget, null); assert.equal(co.services[0].agencyFee, null);
      assert.equal(co.services[0].deliverables.length, 2); assert.equal(co.handover.can.respond, false);
      const sales = expect(await api(actors.salesA, `/projects/${h1.projectId}`));
      assert.equal(sales.handover.can.respond, false); assert.equal(sales.handover.can.nominate, true);
    });
    await check("A nominated PM can open the client record to review it; unrelated PMs cannot", async () => {
      assert.equal((await api(actors.pm, `/clients/${acme.id}`)).status, 200);
      assert.equal((await api(actors.pmOther, `/clients/${acme.id}`)).status, 404);
    });
    await check("Nobody can bypass acceptance through the project edit API", async () => {
      assert.equal((await api(actors.pm, `/projects/${h1.projectId}`, "PATCH", { status: "ACTIVE" })).status, 403, "the nominated PM does not manage it yet");
      expect(await api(actors.admin, `/projects/${h1.projectId}`, "PATCH", { status: "PLANNING" }), 422);
      expect(await api(actors.admin, `/projects/${h1.projectId}`, "PATCH", { manager: actors.pm.id }), 422);
      assert.equal((await api(actors.pm, `/projects/${h1.projectId}/members`, "POST", { add: [] })).status, 403);
      assert.equal((await project(h1.projectId)).manager, null);
    });

    /* -------------------- Rejection and re-nomination -------------------- */
    await check("Only the primary PM can respond; supporting PM, Sales and other PMs cannot", async () => {
      for (const who of ["pmSupport", "pmOther", "salesA", "admin", "worker"]) {
        const r = await api(actors[who], `/projects/${h1.projectId}/handover`, "POST", { action: "accept" });
        assert.ok([403, 404].includes(r.status), `${who} got ${r.status}`);
      }
      assert.equal((await project(h1.projectId)).manager, null);
    });
    await check("12. Rejection needs a real reason; it records the reason, keeps the project ownerless and tells Sales and Admin", async () => {
      expect(await api(actors.pm, `/projects/${h1.projectId}/handover`, "POST", { action: "reject" }), 422);
      expect(await api(actors.pm, `/projects/${h1.projectId}/handover`, "POST", { action: "reject", reason: "no" }), 422);
      const r = expect(await api(actors.pm, `/projects/${h1.projectId}/handover`, "POST", { action: "reject", reason: "Team is fully booked until March" }));
      assert.equal(r.status, "PM_REJECTED");
      const p = await project(h1.projectId); assert.equal(p.status, "PM_REJECTED"); assert.equal(p.manager, null);
      const [a] = await assignments(h1.projectId);
      assert.equal(a.status, "REJECTED"); assert.equal(a.rejectionReason, "Team is fully booked until March"); assert.equal(String(a.respondedBy), actors.pm.id);
      assert.equal(await db.collection("notifications").countDocuments({ recipient: actors.salesA._id, entityId: oid(h1.projectId), title: "Handover rejected" }), 1);
      assert.equal(await db.collection("notifications").countDocuments({ recipient: actors.admin._id, entityId: oid(h1.projectId), title: "Handover rejected" }), 1);
      const again = await api(actors.pm, `/projects/${h1.projectId}/handover`, "POST", { action: "reject", reason: "Trying again after the fact" });
      assert.ok([404, 409].includes(again.status), "a repeat response is refused (the rejecting PM no longer sees the project)");
    });
    await check("Sales re-nominates another PM after a rejection; the earlier nomination stays in the history", async () => {
      assert.ok([403, 404].includes((await api(actors.pm, `/projects/${h1.projectId}/handover`, "POST", { action: "nominate", team: { primaryPm: actors.pmOther.id } })).status), "a PM cannot nominate");
      assert.equal((await api(actors.salesB, `/projects/${h1.projectId}/handover`, "POST", { action: "nominate", team: { primaryPm: actors.pmOther.id } })).status, 404);
      expect(await api(actors.salesA, `/projects/${h1.projectId}/handover`, "POST", { action: "nominate", team: { primaryPm: actors.worker.id } }), 422);
      const r = expect(await api(actors.salesA, `/projects/${h1.projectId}/handover`, "POST", { action: "nominate", team: { primaryPm: actors.pmOther.id, supportingPms: [actors.pmSupport.id], handoverNotes: "Please take this over" } }));
      assert.equal(r.status, "HANDOVER_PENDING");
      const rows = await assignments(h1.projectId);
      assert.equal(rows.length, 2); assert.equal(rows[0].status, "REJECTED"); assert.equal(rows[0].isCurrent, false);
      assert.equal(rows[1].status, "PENDING"); assert.equal(rows[1].sequence, 2); assert.equal(rows[1].isCurrent, true);
      const view = expect(await api(actors.salesA, `/projects/${h1.projectId}`));
      assert.equal(view.handover.previous.length, 1); assert.equal(view.handover.previous[0].rejectionReason, "Team is fully booked until March");
      assert.equal((await api(actors.pm, `/projects/${h1.projectId}`)).status, 404, "the earlier PM no longer sees it");
      assert.equal(await db.collection("notifications").countDocuments({ recipient: actors.pmOther._id, entityId: oid(h1.projectId) }), 1);
    });

    /* -------------------- Acceptance -------------------- */
    await check("13. Accepting makes the PM the owner, adds the supporting PM, and notifies Sales and Admin", async () => {
      const r = expect(await api(actors.pmOther, `/projects/${h1.projectId}/handover`, "POST", { action: "accept" }));
      assert.equal(r.status, "PM_ACCEPTED");
      const p = await project(h1.projectId);
      assert.equal(String(p.manager), actors.pmOther.id); assert.equal(p.status, "PM_ACCEPTED");
      const mgr = await db.collection("projectmembers").findOne({ project: oid(h1.projectId), user: actors.pmOther._id });
      assert.equal(mgr.projectRole, "MANAGER"); assert.equal(mgr.isActive, true);
      assert.ok(await db.collection("projectmembers").findOne({ project: oid(h1.projectId), user: actors.pmSupport._id, isActive: true }));
      const [, a] = await assignments(h1.projectId); assert.equal(a.status, "ACCEPTED");
      assert.equal(await db.collection("notifications").countDocuments({ recipient: actors.salesA._id, entityId: oid(h1.projectId), title: "Handover accepted" }), 1);
      const view = expect(await api(actors.pmOther, `/projects/${h1.projectId}`));
      assert.equal(view.manager.id, actors.pmOther.id); assert.equal(view.can.edit, true); assert.equal(view.handover.status, "ACCEPTED"); assert.equal(view.handover.can.respond, false);
    });
    await check("A second accept, or a late reject, is refused and ownership is unchanged", async () => {
      assert.equal((await api(actors.pmOther, `/projects/${h1.projectId}/handover`, "POST", { action: "accept" })).status, 409);
      assert.equal((await api(actors.pmOther, `/projects/${h1.projectId}/handover`, "POST", { action: "reject", reason: "Changed my mind later" })).status, 409);
      assert.equal((await api(actors.salesA, `/projects/${h1.projectId}/handover`, "POST", { action: "nominate", team: { primaryPm: actors.pm.id } })).status, 409, "no re-nomination once accepted");
      assert.equal(String((await project(h1.projectId)).manager), actors.pmOther.id);
    });
    await check("After acceptance the PM plans: Accepted -> Planning -> Active, never straight to Active, and Active needs a department", async () => {
      const id = h1.projectId;
      expect(await api(actors.pmOther, `/projects/${id}`, "PATCH", { status: "ACTIVE" }), 422);
      expect(await api(actors.pmOther, `/projects/${id}`, "PATCH", { status: "PLANNING" }));
      expect(await api(actors.pmOther, `/projects/${id}`, "PATCH", { status: "ACTIVE" }), 422);
      expect(await api(actors.pmOther, `/projects/${id}`, "PATCH", { departments: [String(ids.dept)], status: "ACTIVE" }));
      assert.equal((await project(id)).status, "ACTIVE");
      expect(await api(actors.pmOther, `/projects/${id}`, "PATCH", { status: "DRAFT" }), 422);
    });
    await check("The PM sees the confirmed services, deliverables and amounts on the accepted project", async () => {
      const v = expect(await api(actors.pmOther, `/projects/${h1.projectId}`));
      assert.equal(v.services.length, 1); assert.equal(v.services[0].deliverables[1].type, "Reel"); assert.equal(v.services[0].approvedBudget, 30000);
      assert.equal(v.departments.length, 1);
    });

    /* -------------------- Drafts and concurrency -------------------- */
    await check("Drafts can be nominated, edited and submitted later; submit needs a PM", async () => {
      const r2 = await approvedReq(actors.salesA, acme);
      const d = expect(await handover(actors.salesA, acme, r2.id, { submit: false, team: { supportingPms: [], handoverNotes: "later" } }), 201);
      assert.equal(d.status, "DRAFT");
      assert.equal((await api(actors.salesA, `/projects/${d.projectId}/handover`, "POST", { action: "submit" })).status, 422);
      expect(await api(actors.salesA, `/projects/${d.projectId}/handover`, "POST", { action: "nominate", team: { primaryPm: actors.pm.id } }));
      assert.equal((await assignments(d.projectId)).length, 1, "a draft nomination is edited in place");
      assert.equal((await api(actors.pm, `/projects/${d.projectId}`)).status, 404, "a draft is invisible to the PM until submitted");
      assert.ok([403, 404].includes((await api(actors.pm, `/projects/${d.projectId}/handover`, "POST", { action: "accept" })).status), "a draft cannot be accepted");
      const s = expect(await api(actors.salesA, `/projects/${d.projectId}/handover`, "POST", { action: "submit" }));
      assert.equal(s.status, "HANDOVER_PENDING");
      assert.equal((await api(actors.salesA, `/projects/${d.projectId}/handover`, "POST", { action: "submit" })).status, 409);
      expect(await api(actors.pm, `/projects/${d.projectId}`));
      createdProjects.push(d.projectId);
    });
    await check("17. CONCURRENCY: five simultaneous accepts yield exactly one owner", async () => {
      const r3 = await approvedReq(actors.salesA, acme);
      const h = expect(await handover(actors.salesA, acme, r3.id), 201);
      const results = await Promise.all(Array.from({ length: 5 }, () => api(actors.pm, `/projects/${h.projectId}/handover`, "POST", { action: "accept" })));
      assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.status)));
      assert.ok(results.filter((r) => r.status !== 200).every((r) => r.status === 409), JSON.stringify(results.map((r) => [r.status, r.data?.error])));
      const p = await project(h.projectId); assert.equal(String(p.manager), actors.pm.id); assert.equal(p.status, "PM_ACCEPTED");
      assert.equal((await assignments(h.projectId)).filter((a) => a.isCurrent).length, 1);
      assert.equal(await db.collection("projectmembers").countDocuments({ project: oid(h.projectId), projectRole: "MANAGER", isActive: true }), 1);
    });
    await check("17. CONCURRENCY: an accept racing a reject and a re-nomination resolves to one consistent state", async () => {
      const r4 = await approvedReq(actors.salesA, acme);
      const h = expect(await handover(actors.salesA, acme, r4.id), 201);
      const results = await Promise.all([
        api(actors.pm, `/projects/${h.projectId}/handover`, "POST", { action: "accept" }),
        api(actors.pm, `/projects/${h.projectId}/handover`, "POST", { action: "reject", reason: "Racing the accept request" }),
        api(actors.salesA, `/projects/${h.projectId}/handover`, "POST", { action: "nominate", team: { primaryPm: actors.pmOther.id } }),
      ]);
      const p = await project(h.projectId); const rows = await assignments(h.projectId);
      assert.equal(rows.filter((a) => a.isCurrent).length, 1, "one current nomination");
      const cur = rows.find((a) => a.isCurrent);
      if (p.status === "PM_ACCEPTED") assert.equal(String(p.manager), String(cur.primaryPm));
      else assert.equal(p.manager, null, `status ${p.status} with results ${results.map((r) => r.status)}`);
      assert.ok(results.filter((r) => r.status === 200).length >= 1);
    });
    await check("17. CONCURRENCY: two handovers for the same requirement cannot both succeed", async () => {
      const r5 = await approvedReq(actors.salesA, acme);
      const results = await Promise.all([1, 2, 3].map(() => handover(actors.salesA, acme, r5.id)));
      assert.equal(results.filter((r) => r.status === 201).length, 1, JSON.stringify(results.map((r) => r.status)));
      assert.equal(await db.collection("projectservices").countDocuments({ requirement: oid(r5.id), isActive: true }), 1);
    });

    /* -------------------- Audit, lists, regressions -------------------- */
    await check("14/17. Every important step is audited", async () => {
      const actions = new Set((await db.collection("auditlogs").find({ entityId: oid(h1.projectId) }).toArray()).map((a) => a.action));
      for (const a of ["project.handover_create", "project.handover_reject", "project.handover_nominate", "project.handover_accept"]) assert.ok(actions.has(a), `missing ${a}`);
      const clientActions = new Set((await db.collection("auditlogs").find({ entityId: oid(acme.id) }).toArray()).map((a) => a.action));
      for (const a of ["client.requirement_add", "client.requirement_update", "client.requirement_sync"]) assert.ok(clientActions.has(a), `missing ${a}`);
      const events = (await assignments(h1.projectId)).flatMap((a) => a.events.map((e) => e.action));
      for (const e of ["created", "submitted", "rejected", "nominated", "accepted"]) assert.ok(events.includes(e), `missing event ${e}`);
    });
    await check("PM options list only active Project Managers, and only for Sales and Admin", async () => {
      const options = expect(await api(actors.salesA, "/handover/pm-options"));
      const got = new Set(options.pms.map((p) => p.id));
      const coord = new Set(options.coordinators.map((p) => p.id));
      assert.ok(coord.has(actors.worker.id) && coord.has(actors.pm.id), "delivery staff can be coordinators");
      assert.ok(!coord.has(actors.salesA.id) && !coord.has(actors.admin.id) && !coord.has(actors.pmInactive.id));
      for (const k of ["pm", "pmOther", "pmSupport"]) assert.ok(got.has(actors[k].id), k);
      for (const k of ["pmInactive", "worker", "salesA", "admin"]) assert.ok(!got.has(actors[k].id), `${k} should not be offered`);
      assert.equal((await api(actors.pm, "/handover/pm-options")).status, 403);
      assert.equal((await api(actors.worker, "/handover/pm-options")).status, 403);
    });
    await check("15. Existing projects (with a manager, no handover) are unaffected", async () => {
      const legacy = oid(); ids.projects.push(legacy);
      await db.collection("projects").insertOne({ _id: legacy, name: `${tag} Legacy`, code: `LGY-${tag.slice(-4)}`, description: "", client: "Old Co", clientRef: null, status: "ACTIVE", priority: "MEDIUM", departments: [ids.dept], manager: actors.pm._id, createdBy: actors.admin._id, isArchived: false, progress: 0, createdAt: new Date(), updatedAt: new Date() });
      await db.collection("projectmembers").insertOne({ project: legacy, user: actors.pm._id, projectRole: "MANAGER", isActive: true, joinedAt: new Date() });
      const v = expect(await api(actors.pm, `/projects/${legacy}`));
      assert.equal(v.handover, null); assert.deepEqual(v.services, []); assert.equal(v.currency, "INR"); assert.equal(v.can.edit, true);
      expect(await api(actors.pm, `/projects/${legacy}`, "PATCH", { status: "ON_HOLD" }));
      expect(await api(actors.pm, `/projects/${legacy}`, "PATCH", { status: "ACTIVE" }));
      const list = expect(await api(actors.pm, "/projects?pageSize=100"));
      assert.ok(list.items.some((p) => p.id === String(legacy)));
      assert.equal((await api(actors.stranger, `/projects/${legacy}`)).status, 404);
    });
    await check("The client's project list shows handover projects with their status to the owner, and hides them from other Sales", async () => {
      const mine = expect(await api(actors.salesA, `/clients/${acme.id}/projects`));
      assert.ok(mine.length >= 3); assert.ok(mine.some((p) => p.status === "PM_ACCEPTED" || p.status === "ACTIVE"));
      assert.equal((await api(actors.salesB, `/clients/${acme.id}/projects`)).status, 404);
    });
    console.log(`${checks} handover integration checks passed.`);
  } finally {
    if (db) {
      const clients = await db.collection("clients").find({ createdBy: { $in: userIds } }).project({ _id: 1 }).toArray();
      const cids = clients.map((c) => c._id);
      const projs = await db.collection("projects").find({ $or: [{ clientRef: { $in: cids } }, { createdBy: { $in: userIds } }, { _id: { $in: ids.projects } }] }).project({ _id: 1 }).toArray();
      const pids = projs.map((p) => p._id);
      await db.collection("projectservices").deleteMany({ project: { $in: pids } });
      await db.collection("pmassignments").deleteMany({ project: { $in: pids } });
      await db.collection("clientservicerequirements").deleteMany({ client: { $in: cids } });
      await db.collection("clienthistories").deleteMany({ client: { $in: cids } });
      await db.collection("clientcontacts").deleteMany({ client: { $in: cids } });
      await db.collection("duplicatereviews").deleteMany({ $or: [{ clientA: { $in: cids } }, { clientB: { $in: cids } }] });
      await db.collection("notifications").deleteMany({ $or: [{ actor: { $in: userIds } }, { recipient: { $in: userIds } }, { entityId: { $in: [...cids, ...pids] } }] });
      await db.collection("auditlogs").deleteMany({ $or: [{ actor: { $in: userIds } }, { entityId: { $in: [...cids, ...pids] } }] });
      await db.collection("tasks").deleteMany({ project: { $in: pids } });
      await db.collection("projectmembers").deleteMany({ project: { $in: pids } });
      await db.collection("projects").deleteMany({ _id: { $in: pids } });
      await db.collection("clients").deleteMany({ _id: { $in: cids } });
      await db.collection("users").deleteMany({ _id: { $in: userIds } });
      await db.collection("departments").deleteMany({ _id: ids.dept });
      console.log("Temporary handover test records removed.");
    }
    await mongoose.disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

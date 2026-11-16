/** Local integration checks. No real accounts or credentials are used. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import nextEnv from "@next/env";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

nextEnv.loadEnvConfig(process.cwd());
const base = process.env.TEST_APP_URL || "http://localhost:3000";
const local = (value) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
if (process.env.NODE_ENV === "production" || !local(base) || !local(process.env.MONGODB_URI)) throw new Error("Use a local development app and database.");
const tag = `TR-${randomBytes(5).toString("hex").toUpperCase()}`;
const password = `CheckA1!${randomBytes(16).toString("hex")}`;
const oid = (id) => id ? new mongoose.Types.ObjectId(id) : new mongoose.Types.ObjectId();
const deptIds = [oid(), oid()];
const userIds = [];
const actors = {};
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
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: `${base}/tickets` }) });
  save(response);
  const session = await (await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookies() } })).json();
  assert.ok(session.user?.id, "Fixture login failed");
  return cookies();
}
async function api(actor, path, method = "GET", body) {
  const response = await fetch(`${base}/api${path}`, { method, headers: { Cookie: actor.cookie, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
const payload = (manager, extra = {}) => ({ title: `${tag} Ticket`, description: "Temporary ticket routing verification", targetDepartment: String(deptIds[1]), ...(manager !== undefined ? { projectManager: manager } : {}), ...extra });
const action = (actor, id, body) => api(actor, `/tickets/${id}/actions`, "POST", body);
const detail = async (actor, id) => expect(await api(actor, `/tickets/${id}`));
const queue = async (actor) => expect(await api(actor, "/tickets?scope=queue&pageSize=100"));

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 }); db = mongoose.connection.db;
    const roles = new Map((await db.collection("roles").find({}).toArray()).map((r) => [r.key, r._id]));
    const hash = await bcrypt.hash(password, 12);
    for (const [key, role] of Object.entries({ requester: "EMPLOYEE", managerA: "PROJECT_MANAGER", managerB: "PROJECT_MANAGER", deptManager: "PROJECT_MANAGER", worker: "EMPLOYEE", inactive: "PROJECT_MANAGER" })) {
      assert.ok(roles.get(role), "Seed the app first");
      const _id = oid(); userIds.push(_id);
      const email = `${tag.toLowerCase()}-${key.toLowerCase()}@example.com`;
      await db.collection("users").insertOne({ _id, name: `${tag} ${key}`, email, employeeId: `${tag}-${key}`, passwordHash: hash, role: roles.get(role), department: key === "worker" ? deptIds[1] : deptIds[0], status: key === "inactive" ? "INACTIVE" : "ACTIVE", sessionVersion: 0 });
      actors[key] = { _id, id: String(_id), ...(key !== "inactive" ? { cookie: await login(email) } : {}) };
    }
    for (let i = 0; i < deptIds.length; i++) await db.collection("departments").insertOne({ _id: deptIds[i], name: `${tag} Department ${i}`, code: `${tag.slice(-8)}${i}`, status: "ACTIVE", head: null, teamLeaders: [], projectManagers: i === 1 ? [actors.deptManager._id] : [], color: "#16a34a" });
    await check("Employees can load active Project Manager choices", async () => {
      const options = expect(await api(actors.requester, "/tickets/managers"));
      assert.ok(options.some((m) => m.id === actors.managerA.id)); assert.ok(options.some((m) => m.id === actors.managerB.id));
      assert.ok(!options.some((m) => m.id === actors.worker.id || m.id === actors.inactive.id));
    });
    await check("Project Manager names include all active managers for every requester", async () => assert.ok(expect(await api(actors.managerA, "/tickets/managers")).some((m) => m.id === actors.managerA.id)));
    let ticket;
    await check("Requester selects a Project Manager outside the target department", async () => {
      ticket = expect(await api(actors.requester, "/tickets", "POST", payload(actors.managerA.id)), 201);
      assert.equal(ticket.projectManager.id, actors.managerA.id); assert.equal(ticket.status, "PENDING_APPROVAL"); assert.equal(ticket.assignee, null);
    });
    await check("Only the selected manager receives the approval request", async () => {
      const notices = await db.collection("notifications").find({ entityId: oid(ticket.id) }).toArray();
      assert.ok(notices.some((n) => String(n.recipient) === actors.managerA.id));
      assert.ok(!notices.some((n) => [actors.managerB.id, actors.deptManager.id, actors.worker.id].includes(String(n.recipient))));
    });
    await check("Selected manager sees the request in their approval queue and dashboard counts", async () => {
      assert.ok((await queue(actors.managerA)).items.some((t) => t.id === ticket.id));
      const summary = expect(await api(actors.managerA, "/tickets/summary")); assert.ok(summary.queue.pendingApproval >= 1);
      const t = await detail(actors.managerA, ticket.id); assert.equal(t.can.approve, true); assert.equal(t.projectManager.id, actors.managerA.id);
    });
    await check("Other managers cannot read or approve a directly routed request", async () => {
      for (const key of ["managerB", "deptManager"]) {
        expect(await api(actors[key], `/tickets/${ticket.id}`), 404);
        expect(await action(actors[key], ticket.id, { action: "approve" }), 404);
        assert.ok(!(await queue(actors[key])).items.some((t) => t.id === ticket.id));
      }
    });
    await check("Requester can change the manager while awaiting approval", async () => {
      expect(await api(actors.requester, `/tickets/${ticket.id}`, "PATCH", { projectManager: actors.managerB.id }));
      assert.equal((await detail(actors.requester, ticket.id)).projectManager.id, actors.managerB.id);
      expect(await api(actors.managerA, `/tickets/${ticket.id}`), 404);
      assert.ok((await queue(actors.managerB)).items.some((t) => t.id === ticket.id));
      assert.ok(await db.collection("notifications").findOne({ entityId: oid(ticket.id), recipient: actors.managerB._id }));
    });
    await check("Selected manager can inspect workload and attachments before assigning", async () => {
      const workload = expect(await api(actors.managerB, `/tickets/workload?department=${deptIds[1]}&ticket=${ticket.id}`));
      assert.ok(workload.some((p) => p.id === actors.worker.id));
      const t = await detail(actors.managerB, ticket.id); assert.ok(Array.isArray(t.attachments)); assert.equal(t.can.upload, true);
    });
    await check("Reviewing tickets stay locked, but editable tickets can choose a new manager", async () => {
      expect(await action(actors.managerB, ticket.id, { action: "start_review" }));
      expect(await api(actors.requester, `/tickets/${ticket.id}`, "PATCH", { projectManager: actors.managerA.id }), 403);
      expect(await action(actors.managerB, ticket.id, { action: "request_info", message: "Please clarify the required sizes." }));
      assert.equal((await detail(actors.requester, ticket.id)).can.changeProjectManager, true);
      expect(await api(actors.requester, `/tickets/${ticket.id}`, "PATCH", { projectManager: actors.managerA.id }));
      const rerouted = await detail(actors.requester, ticket.id);
      assert.equal(rerouted.status, "PENDING_APPROVAL"); assert.equal(rerouted.clarificationRequest, "");
      assert.equal(rerouted.projectManager.id, actors.managerA.id);
      expect(await api(actors.managerB, `/tickets/${ticket.id}`), 404);
      expect(await action(actors.managerA, ticket.id, { action: "start_review" }));
      expect(await action(actors.managerA, ticket.id, { action: "request_info", message: "Please clarify the deadline." }));
      expect(await action(actors.requester, ticket.id, { action: "respond", message: "Next week is suitable." }));
      assert.equal((await detail(actors.requester, ticket.id)).can.changeProjectManager, true);
      expect(await api(actors.requester, `/tickets/${ticket.id}`, "PATCH", { projectManager: actors.managerB.id }));
    });
    await check("Chosen manager approves and assigns an employee", async () => {
      expect(await action(actors.managerB, ticket.id, { action: "approve", assignee: actors.worker.id }));
      const t = await detail(actors.worker, ticket.id); assert.equal(t.status, "ASSIGNED"); assert.equal(t.assignee.id, actors.worker.id);
      assert.equal(t.approvedBy.id, actors.managerB.id); assert.equal(t.projectManager.id, actors.managerB.id);
      expect(await api(actors.requester, `/tickets/${ticket.id}`, "PATCH", { projectManager: actors.managerA.id }), 403);
    });
    await check("My Tasks includes an Assigned tickets tab for users without project tasks", async () => {
      const assigned = expect(await api(actors.worker, "/tickets?scope=assigned"));
      assert.ok(assigned.items.some((t) => t.id === ticket.id));
      const tasks = expect(await api(actors.worker, "/tasks?scope=mine"));
      assert.equal(tasks.total, 0);
      const response = await fetch(`${base}/my-tasks`, { headers: { Cookie: actors.worker.cookie } });
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /Assigned tickets/);
      assert.match(html, /aria-selected="true"[^>]*>Assigned tickets/);
    });
    await check("On Hold tickets remain visible in the assignee's personal work", async () => {
      expect(await action(actors.worker, ticket.id, { action: "start" }));
      expect(await action(actors.worker, ticket.id, { action: "hold", message: "Waiting for input." }));
      const assigned = expect(await api(actors.worker, "/tickets?scope=assigned"));
      assert.equal(assigned.items.find((t) => t.id === ticket.id)?.status, "ON_HOLD");
      const unrelated = expect(await api(actors.managerA, "/tickets?scope=assigned"));
      assert.ok(!unrelated.items.some((t) => t.id === ticket.id));
      expect(await action(actors.worker, ticket.id, { action: "resume" }));
    });
    await check("Selecting a manager does not replace the normal work and review workflow", async () => {
      expect(await action(actors.worker, ticket.id, { action: "submit_work", message: "Work is ready." }));
      expect(await action(actors.requester, ticket.id, { action: "accept" }));
      assert.equal((await detail(actors.requester, ticket.id)).status, "COMPLETED");
    });
    for (const [label, manager] of [["employee", actors.worker.id], ["inactive manager", actors.inactive.id], ["missing manager", String(oid())]]) {
      await check(`Invalid reviewer selection rejects ${label}`, async () => {
        const result = await api(actors.requester, "/tickets", "POST", payload(manager));
        expect(result, 422); assert.ok(result.data.fieldErrors.projectManager);
      });
    }
    await check("A manager cannot route a ticket to themselves for approval", async () => expect(await api(actors.managerA, "/tickets", "POST", payload(actors.managerA.id)), 422));
    await check("Default department routing remains available for existing tickets", async () => {
      const t = expect(await api(actors.requester, "/tickets", "POST", payload(undefined)), 201);
      assert.equal(t.projectManager, null); assert.equal((await detail(actors.deptManager, t.id)).can.approve, true);
      expect(await api(actors.managerA, `/tickets/${t.id}`), 404);
      expect(await api(actors.requester, `/tickets/${t.id}`, "PATCH", { projectManager: actors.managerA.id }));
      assert.equal((await detail(actors.managerA, t.id)).projectManager.id, actors.managerA.id);
      expect(await api(actors.requester, `/tickets/${t.id}`, "PATCH", { projectManager: null }));
      assert.equal((await detail(actors.deptManager, t.id)).can.approve, true);
    });
    await check("Draft manager selection stays private until submission", async () => {
      const draft = expect(await api(actors.requester, "/tickets", "POST", payload(actors.managerA.id, { draft: true })), 201);
      assert.equal(await db.collection("notifications").countDocuments({ entityId: oid(draft.id) }), 0);
      expect(await api(actors.managerA, `/tickets/${draft.id}`), 404);
      expect(await api(actors.requester, `/tickets/${draft.id}`, "PATCH", { projectManager: actors.managerB.id }));
      assert.equal(await db.collection("notifications").countDocuments({ entityId: oid(draft.id) }), 0);
      expect(await action(actors.requester, draft.id, { action: "submit" }));
      assert.equal((await detail(actors.managerB, draft.id)).can.approve, true);
      assert.ok(await db.collection("notifications").findOne({ entityId: oid(draft.id), recipient: actors.managerB._id }));
    });
    console.log(`${checks} ticket routing integration checks passed.`);
  } finally {
    if (db) {
      const tickets = await db.collection("tickets").find({ createdBy: { $in: userIds } }).project({ _id: 1 }).toArray();
      const ids = tickets.map((t) => t._id);
      await db.collection("notifications").deleteMany({ $or: [{ actor: { $in: userIds } }, { recipient: { $in: userIds } }, { entityId: { $in: ids } }] });
      await db.collection("auditlogs").deleteMany({ actor: { $in: userIds } });
      await db.collection("ticketactivities").deleteMany({ ticket: { $in: ids } });
      await db.collection("tickets").deleteMany({ _id: { $in: ids } });
      await db.collection("users").deleteMany({ _id: { $in: userIds } });
      await db.collection("departments").deleteMany({ _id: { $in: deptIds } });
      console.log("Temporary ticket routing test records removed.");
    }
    await mongoose.disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

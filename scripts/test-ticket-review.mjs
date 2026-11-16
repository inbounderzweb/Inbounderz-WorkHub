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
const tag = `TRV-${randomBytes(5).toString("hex").toUpperCase()}`;
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
const payload = (manager, extra = {}) => ({ title: `${tag} Ticket`, description: "Temporary reviewer workflow verification", targetDepartment: String(deptIds[1]), ...(manager !== undefined ? { projectManager: manager } : {}), ...extra });
const action = (actor, id, body) => api(actor, `/tickets/${id}/actions`, "POST", body);
const detail = async (actor, id) => expect(await api(actor, `/tickets/${id}`));

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 }); db = mongoose.connection.db;
    const roles = new Map((await db.collection("roles").find({}).toArray()).map((r) => [r.key, r._id]));
    const hash = await bcrypt.hash(password, 12);
    const fixtures = { requester: "EMPLOYEE", manager: "PROJECT_MANAGER", worker: "EMPLOYEE", reviewer: "PROJECT_MANAGER", reviewer2: "PROJECT_MANAGER", stranger: "EMPLOYEE" };
    for (const [key, role] of Object.entries(fixtures)) {
      assert.ok(roles.get(role), "Seed the app first");
      const _id = oid(); userIds.push(_id);
      const email = `${tag.toLowerCase()}-${key.toLowerCase()}@example.com`;
      await db.collection("users").insertOne({ _id, name: `${tag} ${key}`, email, employeeId: `${tag}-${key}`, passwordHash: hash, role: roles.get(role), department: key === "worker" ? deptIds[1] : deptIds[0], status: "ACTIVE", sessionVersion: 0 });
      actors[key] = { _id, id: String(_id), cookie: await login(email) };
    }
    for (let i = 0; i < deptIds.length; i++) await db.collection("departments").insertOne({ _id: deptIds[i], name: `${tag} Department ${i}`, code: `${tag.slice(-8)}${i}`, status: "ACTIVE", head: null, teamLeaders: [], projectManagers: i === 1 ? [actors.manager._id] : [], color: "#16a34a" });
    const reviews = async (actor, filter = "all") => expect(await api(actor, `/tickets/reviews?filter=${filter}&pageSize=100`));
    const newTicket = async () => expect(await api(actors.requester, "/tickets", "POST", payload(actors.manager.id)), 201);
    const submitted = async (reviewer) => {
      const t = await newTicket();
      expect(await action(actors.manager, t.id, { action: "approve", assignee: actors.worker.id, ...(reviewer ? { reviewer: reviewer.id } : {}) }));
      expect(await action(actors.worker, t.id, { action: "start" }));
      expect(await action(actors.worker, t.id, { action: "submit_work", message: "Ready for review." }));
      return t;
    };
    const mine = (id) => (r) => r.items.some((x) => (x.id ?? x.ticketId) === id);

    await check("Manager assigns an assignee and a reviewer in one step", async () => {
      const t = await newTicket();
      expect(await action(actors.manager, t.id, { action: "approve", assignee: actors.worker.id, reviewer: actors.reviewer.id }));
      const d = await detail(actors.manager, t.id);
      assert.equal(d.assignee.id, actors.worker.id); assert.equal(d.assignedReviewer.id, actors.reviewer.id);
    });
    await check("Reviewer cannot be the same person as the assignee", async () => {
      const t = await newTicket();
      expect(await action(actors.manager, t.id, { action: "approve", assignee: actors.worker.id, reviewer: actors.worker.id }), 400);
    });
    await check("Submitted work routes to the reviewer, not the requester", async () => {
      const t = await submitted(actors.reviewer);
      const d = await detail(actors.reviewer, t.id);
      assert.equal(d.status, "SUBMITTED_FOR_REVIEW"); assert.equal(d.reviewStatus, "PENDING"); assert.equal(d.can.review, true);
      assert.equal((await detail(actors.requester, t.id)).can.review, false);
      assert.ok(await db.collection("notifications").findOne({ entityId: oid(t.id), recipient: actors.reviewer._id }));
      assert.ok(mine(t.id)(await reviews(actors.reviewer, "pending")));
    });
    await check("Requester, assignee and strangers cannot approve or reject", async () => {
      const t = await submitted(actors.reviewer);
      for (const key of ["requester", "worker", "stranger"]) {
        const a = await action(actors[key], t.id, { action: "accept" }); assert.ok([403, 404].includes(a.status), `${key} accept -> ${a.status}`);
        const r = await action(actors[key], t.id, { action: "request_changes", message: "No." }); assert.ok([403, 404].includes(r.status), `${key} reject -> ${r.status}`);
      }
      assert.equal((await detail(actors.reviewer, t.id)).status, "SUBMITTED_FOR_REVIEW");
    });
    await check("Rejection returns work to the assignee with comments, resubmission goes to the same reviewer", async () => {
      const t = await submitted(actors.reviewer);
      expect(await action(actors.reviewer, t.id, { action: "request_changes", message: "Banner is too small." }));
      let d = await detail(actors.worker, t.id);
      assert.equal(d.status, "IN_PROGRESS"); assert.equal(d.reviewStatus, "CHANGES_REQUESTED");
      assert.ok(d.reviewComments.some((c) => /too small/.test(c.message ?? c.comment ?? "")));
      assert.ok(mine(t.id)(await reviews(actors.reviewer, "changes")));
      expect(await action(actors.worker, t.id, { action: "submit_work", message: "Resized." }));
      d = await detail(actors.reviewer, t.id);
      assert.equal(d.reviewStatus, "PENDING"); assert.equal(d.assignedReviewer.id, actors.reviewer.id);
    });
    await check("Approval completes the ticket, notifies once, and a second decision is rejected", async () => {
      const t = await submitted(actors.reviewer);
      expect(await action(actors.reviewer, t.id, { action: "accept", message: "Looks good." }));
      const d = await detail(actors.reviewer, t.id);
      assert.equal(d.status, "COMPLETED"); assert.equal(d.reviewStatus, "APPROVED");
      const again = await action(actors.reviewer, t.id, { action: "accept" }); assert.ok([403, 409].includes(again.status), `duplicate -> ${again.status}`);
      for (const key of ["worker", "requester"]) {
        const n = await db.collection("notifications").countDocuments({ entityId: oid(t.id), recipient: actors[key]._id, title: /approved|completed/i });
        assert.ok(n <= 1, `${key} received ${n} completion notices`);
      }
      assert.ok(mine(t.id)(await reviews(actors.reviewer, "approved")));
    });
    await check("Reassigning during review needs a reason, records history, and locks out the previous reviewer", async () => {
      const t = await submitted(actors.reviewer);
      expect(await action(actors.manager, t.id, { action: "set_reviewer", reviewer: actors.reviewer2.id, message: "" }), 400);
      expect(await action(actors.manager, t.id, { action: "set_reviewer", reviewer: actors.reviewer2.id, message: "Original reviewer is on leave." }));
      const d = await detail(actors.manager, t.id);
      assert.equal(d.assignedReviewer.id, actors.reviewer2.id); assert.ok(d.reviewHistory.length >= 1);
      const old = await action(actors.reviewer, t.id, { action: "accept" }); assert.ok([403, 404].includes(old.status), `previous reviewer -> ${old.status}`);
      assert.ok(await db.collection("notifications").findOne({ entityId: oid(t.id), recipient: actors.reviewer2._id }));
      expect(await action(actors.reviewer2, t.id, { action: "accept" }));
    });
    await check("Legacy ticket without a reviewer is still reviewed by the requester", async () => {
      const t = await submitted(null);
      const d = await detail(actors.requester, t.id);
      assert.equal(d.can.review, true); assert.equal(d.assignedReviewer, null);
      expect(await action(actors.requester, t.id, { action: "accept" }));
      assert.equal((await detail(actors.requester, t.id)).status, "COMPLETED");
    });
    console.log(`${checks} reviewer workflow integration checks passed.`);
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
      console.log("Temporary reviewer workflow test records removed.");
    }
    await mongoose.disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

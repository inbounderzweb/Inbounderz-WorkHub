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
const tag = `TDL-${randomBytes(5).toString("hex").toUpperCase()}`;
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
const payload = (manager, extra = {}) => ({ title: `${tag} Ticket`, description: "Temporary deliverables verification", targetDepartment: String(deptIds[1]), ...(manager !== undefined ? { projectManager: manager } : {}), ...extra });
const action = (actor, id, body) => api(actor, `/tickets/${id}/actions`, "POST", body);
const detail = async (actor, id) => expect(await api(actor, `/tickets/${id}`));
const raised = (extra) => api(actors.requester, "/tickets", "POST", payload(actors.manager.id, extra));
const byType = (t) => Object.fromEntries(t.deliverables.map((d) => [d.type, d]));
const lastActivity = (t, act) => t.activity.find((a) => a.action === act);

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 }); db = mongoose.connection.db;
    const roles = new Map((await db.collection("roles").find({}).toArray()).map((r) => [r.key, r._id]));
    const hash = await bcrypt.hash(password, 12);
    const fixtures = { requester: "EMPLOYEE", manager: "PROJECT_MANAGER", worker: "EMPLOYEE", reviewer: "PROJECT_MANAGER", stranger: "EMPLOYEE" };
    for (const [key, role] of Object.entries(fixtures)) {
      assert.ok(roles.get(role), "Seed the app first");
      const _id = oid(); userIds.push(_id);
      const email = `${tag.toLowerCase()}-${key.toLowerCase()}@example.com`;
      await db.collection("users").insertOne({ _id, name: `${tag} ${key}`, email, employeeId: `${tag}-${key}`, passwordHash: hash, role: roles.get(role), department: key === "worker" ? deptIds[1] : deptIds[0], status: "ACTIVE", sessionVersion: 0 });
      actors[key] = { _id, id: String(_id), cookie: await login(email) };
    }
    for (let i = 0; i < deptIds.length; i++) await db.collection("departments").insertOne({ _id: deptIds[i], name: `${tag} Department ${i}`, code: `${tag.slice(-8)}${i}`, status: "ACTIVE", head: null, teamLeaders: [], projectManagers: i === 1 ? [actors.manager._id] : [], color: "#16a34a" });

    const requested = [
      { type: "Video", quantity: 2, specifications: "16:9, under 60 s" },
      { type: "Photo", quantity: 1 },
      { type: "Social Media Post", quantity: 3 },
    ];
    let t;
    await check("Requester raises a ticket with several deliverables, each with its own quantity", async () => {
      const created = expect(await raised({ deliverables: requested }), 201);
      assert.deepEqual(created.deliverableSummary, { count: 3, requested: 6, completed: 0, verified: 0, percent: 0 });
      t = await detail(actors.requester, created.id);
      assert.deepEqual(t.deliverables.map((d) => [d.type, d.quantity, d.status]), [["Video", 2, "NOT_STARTED"], ["Photo", 1, "NOT_STARTED"], ["Social Media Post", 3, "NOT_STARTED"]]);
      assert.equal(byType(t).Video.specifications, "16:9, under 60 s");
      assert.ok(t.deliverables.every((d) => /^[a-f\d]{24}$/.test(d.id)));
    });
    await check("Invalid quantities and types are rejected by the server", async () => {
      for (const bad of [{ type: "Video", quantity: 0 }, { type: "Video", quantity: 1.5 }, { type: "Video", quantity: -2 }, { type: " ", quantity: 1 }]) {
        expect(await raised({ deliverables: [bad] }), 422);
      }
      expect(await raised({ deliverables: Array.from({ length: 21 }, () => ({ type: "Photo", quantity: 1 })) }), 422);
    });
    await check("Requester edits deliverables before approval; existing rows keep their ids", async () => {
      const ids = byType(t);
      const next = [{ id: ids.Video.id, type: "Video", quantity: 3, specifications: ids.Video.specifications }, { id: ids.Photo.id, type: "Photo", quantity: 1 }, { id: ids["Social Media Post"].id, type: "Social Media Post", quantity: 3 }, { type: "Banner", quantity: 1 }];
      expect(await api(actors.requester, `/tickets/${t.id}`, "PATCH", { deliverables: next }));
      t = await detail(actors.requester, t.id);
      assert.equal(byType(t).Video.id, ids.Video.id); assert.equal(byType(t).Video.quantity, 3); assert.equal(t.deliverables.length, 4);
      assert.match(lastActivity(t, "UPDATED").message, /Video: 2 → 3/);
      expect(await api(actors.requester, `/tickets/${t.id}`, "PATCH", { deliverables: [{ id: oid().toString(), type: "Forged", quantity: 1 }] }), 422);
    });
    await check("Project Manager sees the deliverables before approving; the requester can't use the change action", async () => {
      const m = await detail(actors.manager, t.id);
      assert.equal(m.can.approve, true); assert.equal(m.deliverables.length, 4); assert.equal(m.can.changeDeliverables, true);
      expect(await action(actors.requester, t.id, { action: "change_deliverables", deliverables: [], message: "x" }), 403);
      expect(await action(actors.manager, t.id, { action: "approve", assignee: actors.worker.id, reviewer: actors.reviewer.id }));
    });
    await check("Approved requirements are locked for the requester", async () => {
      expect(await api(actors.requester, `/tickets/${t.id}`, "PATCH", { deliverables: [] }), 403);
      assert.equal((await detail(actors.requester, t.id)).deliverables.length, 4);
    });
    await check("Only the assignee records progress, only while working, within the requested quantity", async () => {
      const ids = byType(t);
      expect(await action(actors.worker, t.id, { action: "record_progress", items: [{ id: ids.Video.id, completedQuantity: 1 }] }), 403);
      expect(await action(actors.worker, t.id, { action: "start" }));
      expect(await action(actors.worker, t.id, { action: "record_progress", items: [{ id: ids.Video.id, completedQuantity: 4 }] }), 422);
      for (const key of ["requester", "stranger", "reviewer"]) {
        const r = await action(actors[key], t.id, { action: "record_progress", items: [{ id: ids.Video.id, completedQuantity: 1 }] });
        assert.ok([403, 404].includes(r.status), `${key} -> ${r.status}`);
      }
      expect(await action(actors.worker, t.id, { action: "record_progress", items: [{ id: ids.Video.id, completedQuantity: 3 }, { id: ids.Photo.id, completedQuantity: 1 }, { id: ids["Social Media Post"].id, completedQuantity: 2 }] }));
      t = await detail(actors.worker, t.id);
      assert.deepEqual(t.deliverables.map((d) => `${d.type} ${d.completedQuantity}/${d.quantity} ${d.status}`), ["Video 3/3 AWAITING_VERIFICATION", "Photo 1/1 AWAITING_VERIFICATION", "Social Media Post 2/3 IN_PROGRESS", "Banner 0/1 NOT_STARTED"]);
      assert.match(lastActivity(t, "DELIVERABLE_PROGRESS").message, /Social Media Post: 0 → 2 of 3/);
    });
    await check("Work can't be submitted until every requested quantity is reached", async () => {
      const r = expect(await action(actors.worker, t.id, { action: "submit_work" }), 422);
      assert.match(r.error, /Social Media Post 2\/3/); assert.match(r.error, /Banner 0\/1/);
    });
    await check("Changing approved requirements needs the Project Manager, a reason, and can't undo completed work", async () => {
      const ids = byType(t);
      const keep = t.deliverables.map((d) => ({ id: d.id, type: d.type, quantity: d.quantity, specifications: d.specifications }));
      expect(await action(actors.manager, t.id, { action: "change_deliverables", deliverables: keep, message: "" }), 422);
      expect(await action(actors.manager, t.id, { action: "change_deliverables", deliverables: keep.map((d) => d.id === ids.Video.id ? { ...d, quantity: 2 } : d), message: "Fewer videos" }), 422);
      expect(await action(actors.manager, t.id, { action: "change_deliverables", deliverables: keep.filter((d) => d.id !== ids.Photo.id), message: "Drop photo" }), 422);
      expect(await action(actors.worker, t.id, { action: "change_deliverables", deliverables: keep, message: "x" }), 403);
      expect(await action(actors.manager, t.id, { action: "change_deliverables", deliverables: keep.map((d) => d.id === ids["Social Media Post"].id ? { ...d, quantity: 4 } : d), message: "Client asked for one more post" }));
      t = await detail(actors.manager, t.id);
      assert.equal(byType(t)["Social Media Post"].quantity, 4); assert.equal(byType(t)["Social Media Post"].completedQuantity, 2);
      assert.match(lastActivity(t, "DELIVERABLES_CHANGED").message, /Client asked for one more post[\s\S]*Social Media Post: 3 → 4/);
      const audit = await db.collection("auditlogs").findOne({ entityId: oid(t.id), action: "ticket.deliverables_changed" });
      assert.match(audit.changes.deliverables.from, /Social Media Post 3/); assert.match(audit.changes.deliverables.to, /Social Media Post 4/);
      assert.ok(await db.collection("notifications").findOne({ entityId: oid(t.id), recipient: actors.worker._id, title: "Requested deliverables changed" }));
    });
    await check("Reviewer verifies part of the work and sends the rest back; verified progress is kept", async () => {
      const ids = byType(t);
      expect(await action(actors.worker, t.id, { action: "record_progress", items: [{ id: ids["Social Media Post"].id, completedQuantity: 4 }, { id: ids.Banner.id, completedQuantity: 1 }] }));
      expect(await action(actors.worker, t.id, { action: "submit_work" }));
      expect(await action(actors.reviewer, t.id, { action: "request_changes", message: "Videos are fine", verified: [{ id: ids.Banner.id, verifiedQuantity: 2 }] }), 422);
      expect(await action(actors.reviewer, t.id, { action: "request_changes", message: "Videos and photo are fine, redo the posts", verified: [{ id: ids.Video.id, verifiedQuantity: 3 }, { id: ids.Photo.id, verifiedQuantity: 1 }] }));
      t = await detail(actors.worker, t.id);
      assert.equal(t.status, "IN_PROGRESS");
      assert.equal(byType(t).Video.status, "COMPLETED"); assert.equal(byType(t).Photo.status, "COMPLETED");
      assert.equal(byType(t)["Social Media Post"].status, "AWAITING_VERIFICATION");
    });
    await check("Assignee can't reduce progress below what the reviewer verified", async () => {
      expect(await action(actors.worker, t.id, { action: "record_progress", items: [{ id: byType(t).Video.id, completedQuantity: 2 }] }), 422);
    });
    await check("Approval verifies everything and the ticket reports 100% verified", async () => {
      expect(await action(actors.worker, t.id, { action: "submit_work", message: "Posts redone" }));
      expect(await action(actors.reviewer, t.id, { action: "accept" }));
      t = await detail(actors.requester, t.id);
      assert.equal(t.status, "COMPLETED");
      assert.ok(t.deliverables.every((d) => d.status === "COMPLETED" && d.verifiedQuantity === d.quantity));
      const list = expect(await api(actors.requester, "/tickets?scope=raised&pageSize=100"));
      assert.deepEqual(list.items.find((x) => x.id === t.id).deliverableSummary, { count: 4, requested: 9, completed: 9, verified: 9, percent: 100 });
      expect(await action(actors.manager, t.id, { action: "change_deliverables", deliverables: [], message: "too late" }), 403);
    });
    await check("Tickets without deliverables keep the existing workflow", async () => {
      const plain = expect(await raised({}), 201);
      assert.equal(plain.deliverableSummary, null);
      expect(await action(actors.manager, plain.id, { action: "approve", assignee: actors.worker.id }));
      expect(await action(actors.worker, plain.id, { action: "start", pausePrevious: true }));
      expect(await action(actors.worker, plain.id, { action: "submit_work" }));
      expect(await action(actors.requester, plain.id, { action: "accept" }));
      assert.equal((await detail(actors.requester, plain.id)).status, "COMPLETED");
    });
    console.log(`${checks} deliverable integration checks passed.`);
  } finally {
    if (db) {
      const tickets = await db.collection("tickets").find({ createdBy: { $in: userIds } }).project({ _id: 1 }).toArray();
      const ids = tickets.map((x) => x._id);
      await db.collection("notifications").deleteMany({ $or: [{ actor: { $in: userIds } }, { recipient: { $in: userIds } }, { entityId: { $in: ids } }] });
      await db.collection("auditlogs").deleteMany({ $or: [{ actor: { $in: userIds } }, { entityId: { $in: ids } }] });
      await db.collection("ticketactivities").deleteMany({ ticket: { $in: ids } });
      await db.collection("ticketqueues").deleteMany({ _id: { $in: userIds } });
      await db.collection("tickets").deleteMany({ _id: { $in: ids } });
      await db.collection("users").deleteMany({ _id: { $in: userIds } });
      await db.collection("departments").deleteMany({ _id: { $in: deptIds } });
      console.log("Temporary deliverable test records removed.");
    }
    await mongoose.disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

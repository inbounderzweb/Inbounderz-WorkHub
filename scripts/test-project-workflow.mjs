/** Integration checks against a running local app. Temporary records are removed in finally. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import nextEnv from "@next/env";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

nextEnv.loadEnvConfig(process.cwd());
const base = process.env.TEST_APP_URL || "http://localhost:3000";
const local = (value) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
if (process.env.NODE_ENV === "production" || !local(base) || !local(process.env.MONGODB_URI)) {
  throw new Error("Run against a local development app and MongoDB only.");
}
const tag = `WF-${randomBytes(5).toString("hex").toUpperCase()}`;
const password = `CheckA1!${randomBytes(16).toString("hex")}`;
const objectId = () => new mongoose.Types.ObjectId();
const userIds = [];
const projectIds = [];
const deptIds = [objectId(), objectId()];
const taskIds = [];
let db;
let checks = 0;

async function check(label, run) {
  await run();
  console.log(`PASS ${label}`);
  checks++;
}

async function login(email) {
  const jar = new Map();
  const save = (r) => r.headers.getSetCookie().forEach((v) => {
    const pair = v.split(";", 1)[0];
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  });
  const cookies = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const csrf = await fetch(`${base}/api/auth/csrf`);
  save(csrf);
  const { csrfToken } = await csrf.json();
  const response = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1", Cookie: cookies() },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: `${base}/projects` }),
  });
  save(response);
  const session = await (await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookies() } })).json();
  assert.ok(session.user?.id, "Test account must be authenticated");
  return cookies();
}

async function api(actor, path, method = "GET", body) {
  const response = await fetch(`${base}/api${path}`, {
    method, headers: { Cookie: actor.cookie, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (response.status === 201 && data.id) {
    if (path === "/projects") projectIds.push(new mongoose.Types.ObjectId(data.id));
    if (path === "/tasks") taskIds.push(new mongoose.Types.ObjectId(data.id));
  }
  return { status: response.status, data };
}

function expectStatus(result, status) {
  assert.equal(result.status, status, JSON.stringify(result.data));
  return result.data;
}

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    db = mongoose.connection.db;
    const roles = new Map((await db.collection("roles").find({}).toArray()).map((r) => [r.key, r._id]));
    const hash = await bcrypt.hash(password, 12);
    const actors = {};
    for (const [key, role] of Object.entries({ pm: "PROJECT_MANAGER", co: "PROJECT_MANAGER", outsider: "PROJECT_MANAGER", head: "DEPARTMENT_HEAD", lead: "TEAM_LEADER", employee: "EMPLOYEE" })) {
      assert.ok(roles.get(role), "Seed the app before running integration checks");
      const _id = objectId(); userIds.push(_id);
      const email = `${tag.toLowerCase()}-${key}@example.com`;
      await db.collection("users").insertOne({ _id, name: `${tag} ${key}`, email, employeeId: `${tag}-${key}`, passwordHash: hash, role: roles.get(role), department: deptIds[0], status: "ACTIVE", sessionVersion: 0 });
      actors[key] = { _id, id: String(_id), cookie: await login(email) };
    }
    for (let i = 0; i < deptIds.length; i++) await db.collection("departments").insertOne({ _id: deptIds[i], name: `${tag} Department ${i}`, code: `${tag.slice(-8)}${i}`, status: "ACTIVE", head: i === 0 ? actors.head._id : null, teamLeaders: [], projectManagers: [], color: "#16a34a" });
    let project;
    await check("Project Manager creates a project and attaches department leaders", async () => {
      project = expectStatus(await api(actors.pm, "/projects", "POST", {
        name: `${tag} Project`, departments: [String(deptIds[0])], status: "ACTIVE",
        members: ["head", "lead"].map((key) => ({ user: actors[key].id, department: String(deptIds[0]), projectRole: "LEAD" })),
      }), 201);
    });
    await db.collection("projectmembers").insertOne({ project: new mongoose.Types.ObjectId(project.id), user: actors.co._id, projectRole: "MANAGER", department: null, isActive: true });
    const create = (owner, requestProjectApproval = false, department = String(deptIds[0])) => ({ project: project.id, department, owner, title: `${tag} Work ${taskIds.length}`, description: "Prepare campaign assets and verify all acceptance criteria.", requestProjectApproval });
    const detail = async (actor, id) => expectStatus(await api(actor, `/tasks/${id}`), 200);
    const action = (actor, id, body) => api(actor, `/tasks/${id}/work-approval`, "POST", body);

    await check("Allocated Team Leader can create work without department leadership setup", async () => {
      const options = expectStatus(await api(actors.lead, "/projects?minimal=1"), 200);
      const option = options.find((p) => p.id === project.id);
      assert.ok(option.taskDepartments.includes(String(deptIds[0])));
      assert.equal(option.canAddDepartments, false);
    });
    await check("Assignee picker includes the Team Leader and department employees", async () => {
      const team = expectStatus(await api(actors.lead, `/projects/${project.id}/team?department=${deptIds[0]}&staff=1`), 200);
      assert.ok(team.some((m) => m.id === actors.lead.id));
      assert.ok(team.some((m) => m.id === actors.employee.id));
    });
    let request;
    await check("Department Head submits a work description without an assignee", async () => {
      request = expectStatus(await api(actors.head, "/tasks", "POST", create(null)), 201);
      assert.equal(request.workApprovalStatus, "PENDING");
      const t = await detail(actors.head, request.id);
      assert.equal(t.owner, null); assert.equal(t.workApproval.requestedBy.id, actors.head.id);
    });
    await check("Every project manager receives the work request notification", async () => {
      for (const key of ["pm", "co"]) assert.ok(await db.collection("notifications").findOne({ recipient: actors[key]._id, entityId: new mongoose.Types.ObjectId(request.id), type: "REVIEW" }));
    });
    await check("Request appears in the Project Manager dashboard and task queue", async () => {
      for (const key of ["pm", "co"]) {
        const dashboard = expectStatus(await api(actors[key], "/dashboard"), 200);
        assert.ok(dashboard.workRequests.some((t) => t.id === request.id));
        assert.ok(dashboard.stats.pendingWorkRequests >= 1);
        const tasks = expectStatus(await api(actors[key], `/tasks?scope=all&project=${project.id}&workQueue=pending`), 200);
        assert.ok(tasks.items.some((t) => t.id === request.id));
      }
    });
    await check("Unrelated Project Manager cannot see or approve project requests", async () => {
      expectStatus(await api(actors.outsider, `/tasks/${request.id}`), 404);
      expectStatus(await action(actors.outsider, request.id, { action: "APPROVE" }), 404);
      const tasks = expectStatus(await api(actors.outsider, "/tasks?scope=all&workQueue=pending"), 200);
      assert.ok(!tasks.items.some((t) => t.id === request.id));
    });
    await check("Department Head cannot approve their own work request", async () => expectStatus(await action(actors.head, request.id, { action: "APPROVE" }), 403));
    await check("Manager must choose an assignee before approving", async () => expectStatus(await action(actors.pm, request.id, { action: "APPROVE" }), 422));
    await check("Manager can request changes and the requester can edit and resubmit", async () => {
      expectStatus(await action(actors.pm, request.id, { action: "REQUEST_CHANGES" }), 422);
      expectStatus(await action(actors.pm, request.id, { action: "REQUEST_CHANGES", comment: "Add the delivery sizes." }), 200);
      assert.equal((await detail(actors.head, request.id)).workApprovalStatus, "CHANGES_REQUESTED");
      expectStatus(await api(actors.head, `/tasks/${request.id}`, "PATCH", { description: "Deliver desktop and mobile campaign assets." }), 200);
      expectStatus(await action(actors.head, request.id, { action: "REQUEST" }), 200);
    });
    await check("Project Manager approves and assigns to an eligible department employee", async () => {
      expectStatus(await api(actors.pm, `/tasks/${request.id}/assign`, "POST", { department: String(deptIds[0]), owner: actors.employee.id }), 200);
      const t = await detail(actors.employee, request.id);
      assert.equal(t.workApprovalStatus, "APPROVED"); assert.equal(t.assignedBy.id, actors.pm.id);
      assert.equal(t.workApproval.reviewedBy.id, actors.pm.id); assert.equal(t.can.trackTime, true);
      assert.ok(await db.collection("projectmembers").findOne({ project: new mongoose.Types.ObjectId(project.id), user: actors.employee._id, isActive: true }));
    });
    await check("A request cannot be approved twice", async () => expectStatus(await action(actors.co, request.id, { action: "APPROVE" }), 409));
    await check("Approved employee work still supports timer and completion review", async () => {
      expectStatus(await api(actors.employee, `/tasks/${request.id}/timer`, "POST", { action: "START" }), 200);
      expectStatus(await api(actors.employee, `/tasks/${request.id}/timer`, "POST", { action: "PAUSE" }), 200);
      expectStatus(await api(actors.employee, `/tasks/${request.id}/status`, "PATCH", { status: "IN_REVIEW" }), 200);
      expectStatus(await api(actors.employee, `/tasks/${request.id}/review`, "POST", { decision: "APPROVE" }), 403);
      expectStatus(await api(actors.co, `/tasks/${request.id}/review`, "POST", { decision: "APPROVE" }), 200);
      assert.equal((await detail(actors.pm, request.id)).status, "COMPLETED");
    });
    let selfRequest;
    await check("Team Leader proposes themselves and requests Project Manager approval", async () => {
      selfRequest = expectStatus(await api(actors.lead, "/tasks", "POST", create(actors.lead.id, true)), 201);
      const t = await detail(actors.lead, selfRequest.id);
      assert.equal(t.workApprovalStatus, "PENDING"); assert.equal(t.owner.id, actors.lead.id);
      assert.equal(t.assignedBy, null); assert.deepEqual(t.allowedStatuses, []); assert.equal(t.can.trackTime, false);
    });
    await check("Pending approval blocks status, time, hours and checklist work", async () => {
      expectStatus(await api(actors.lead, `/tasks/${selfRequest.id}/status`, "PATCH", { status: "IN_PROGRESS" }), 422);
      expectStatus(await api(actors.lead, `/tasks/${selfRequest.id}/timer`, "POST", { action: "START" }), 422);
      expectStatus(await api(actors.lead, `/tasks/${selfRequest.id}`, "PATCH", { actualHours: 2 }), 422);
      expectStatus(await api(actors.lead, `/tasks/${selfRequest.id}/checklist`, "POST", { text: "Done" }), 422);
    });
    await check("Changing a proposed assignment cannot bypass pending approval", async () => {
      expectStatus(await api(actors.lead, `/tasks/${selfRequest.id}/assign`, "POST", { department: String(deptIds[0]), owner: actors.employee.id, requestProjectApproval: false }), 200);
      assert.equal((await detail(actors.lead, selfRequest.id)).workApprovalStatus, "PENDING");
    });
    await check("An additional project manager can approve the proposed assignee", async () => {
      expectStatus(await action(actors.co, selfRequest.id, { action: "APPROVE" }), 200);
      const t = await detail(actors.employee, selfRequest.id);
      assert.equal(t.workApprovalStatus, "APPROVED"); assert.equal(t.workApproval.reviewedBy.id, actors.co.id);
    });
    let direct;
    await check("Team Leader can still assign themselves directly and PM can see the work", async () => {
      direct = expectStatus(await api(actors.lead, "/tasks", "POST", create(actors.lead.id, false)), 201);
      assert.equal(direct.workApprovalStatus, "NOT_REQUIRED");
      const t = await detail(actors.pm, direct.id); assert.equal(t.owner.id, actors.lead.id);
      assert.equal((await detail(actors.lead, direct.id)).can.trackTime, true);
    });
    await check("Assign dialog can send a new proposed owner for PM approval", async () => {
      expectStatus(await api(actors.lead, `/tasks/${direct.id}/assign`, "POST", { department: String(deptIds[0]), owner: actors.employee.id, requestProjectApproval: true }), 200);
      assert.equal((await detail(actors.pm, direct.id)).workApprovalStatus, "PENDING");
    });
    await check("Department leaders cannot add or reassign work to another department", async () => {
      expectStatus(await api(actors.lead, "/tasks", "POST", create(actors.employee.id, false, String(deptIds[1]))), 403);
      expectStatus(await api(actors.lead, `/tasks/${direct.id}/assign`, "POST", { department: String(deptIds[1]), owner: actors.employee.id }), 403);
    });
    await check("Ordinary employees cannot create work requests", async () => expectStatus(await api(actors.employee, "/tasks", "POST", create(actors.employee.id, true)), 403));
    await check("Normal reassignment closes a running timer and preserves its time log", async () => {
      const t = expectStatus(await api(actors.lead, "/tasks", "POST", create(actors.lead.id, false)), 201);
      expectStatus(await api(actors.lead, `/tasks/${t.id}/timer`, "POST", { action: "START" }), 200);
      expectStatus(await api(actors.lead, `/tasks/${t.id}/assign`, "POST", { department: String(deptIds[0]), owner: actors.employee.id }), 200);
      const reassigned = await detail(actors.employee, t.id);
      assert.equal(reassigned.owner.id, actors.employee.id); assert.equal(reassigned.timer.running, false);
      assert.equal(reassigned.timer.log[0].user.id, actors.lead.id);
    });
    await check("Legacy tasks without work approval fields retain their workflow", async () => {
      const t = expectStatus(await api(actors.lead, "/tasks", "POST", create(actors.lead.id, false)), 201);
      await db.collection("tasks").updateOne({ _id: new mongoose.Types.ObjectId(t.id) }, { $unset: { workApproval: "" } });
      const legacy = await detail(actors.lead, t.id);
      assert.equal(legacy.workApprovalStatus, "NOT_REQUIRED"); assert.equal(legacy.can.trackTime, true);
      expectStatus(await api(actors.lead, `/tasks/${t.id}/status`, "PATCH", { status: "IN_PROGRESS" }), 200);
    });
    await check("Archived projects reject request approval", async () => {
      await db.collection("projects").updateOne({ _id: new mongoose.Types.ObjectId(project.id) }, { $set: { isArchived: true } });
      expectStatus(await action(actors.pm, direct.id, { action: "APPROVE" }), 422);
      await db.collection("projects").updateOne({ _id: new mongoose.Types.ObjectId(project.id) }, { $set: { isArchived: false } });
    });
    await check("An existing task can request approval without changing its assignee", async () => {
      const t = expectStatus(await api(actors.lead, "/tasks", "POST", create(actors.lead.id, false)), 201);
      expectStatus(await action(actors.lead, t.id, { action: "REQUEST", comment: "Please review this scope." }), 200);
      expectStatus(await action(actors.pm, t.id, { action: "APPROVE" }), 200);
      assert.equal((await detail(actors.lead, t.id)).workApprovalStatus, "APPROVED");
    });
    await check("PM dashboard renders its work request section", async () => {
      const response = await fetch(`${base}/dashboard`, { headers: { Cookie: actors.pm.cookie } });
      assert.equal(response.status, 200);
      assert.match(await response.text(), /Work requests awaiting approval/);
    });
    console.log(`${checks} project workflow integration checks passed.`);
  } finally {
    if (db) {
      const createdTasks = await db.collection("tasks").find({ project: { $in: projectIds } }).project({ _id: 1 }).toArray();
      const cleanupTaskIds = createdTasks.map((t) => t._id);
      // Match only this run's fixtures; sequence counters intentionally remain monotonic.
      await db.collection("notifications").deleteMany({ $or: [{ actor: { $in: userIds } }, { recipient: { $in: userIds } }] });
      await db.collection("auditlogs").deleteMany({ actor: { $in: userIds } });
      await db.collection("taskactivities").deleteMany({ task: { $in: cleanupTaskIds } });
      await db.collection("taskcomments").deleteMany({ task: { $in: cleanupTaskIds } });
      await db.collection("tasks").deleteMany({ _id: { $in: cleanupTaskIds } });
      await db.collection("projectmembers").deleteMany({ project: { $in: projectIds } });
      await db.collection("projects").deleteMany({ _id: { $in: projectIds } });
      await db.collection("users").deleteMany({ _id: { $in: userIds } });
      await db.collection("departments").deleteMany({ _id: { $in: deptIds } });
      console.log("Temporary workflow test records removed.");
    }
    await mongoose.disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

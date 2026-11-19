/** Browser workflow against a local app. Install Playwright or set PLAYWRIGHT_MODULE to an existing installation. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import nextEnv from "@next/env";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

nextEnv.loadEnvConfig(process.cwd());
const base = process.env.TEST_APP_URL || "http://localhost:3000";
const local = (v) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(v).hostname);
if (process.env.NODE_ENV === "production" || !local(base) || !local(process.env.MONGODB_URI)) throw new Error("Use a local app and database only.");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const tag = `UI-${randomBytes(4).toString("hex")}`;
const password = `CheckA1!${randomBytes(16).toString("hex")}`;
const ids = [];
let browser, db, checks = 0;
const check = async (label, fn) => { await fn(); checks++; console.log(`PASS ${label}`); };
const pageErrors = [];

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI); db = mongoose.connection.db;
    const roles = new Map((await db.collection("roles").find().toArray()).map((r) => [r.key, r._id]));
    const hash = await bcrypt.hash(password, 12);
    const people = {};
    for (const [name, role] of Object.entries({ sales: "SALES_EXECUTIVE", pm: "PROJECT_MANAGER", supporting: "PROJECT_MANAGER", stranger: "EMPLOYEE" })) {
      const _id = new mongoose.Types.ObjectId(); ids.push(_id);
      people[name] = { _id, name: `${tag} ${name}`, email: `${tag}-${name}@example.com`.toLowerCase() };
      await db.collection("users").insertOne({ ...people[name], employeeId: `${tag}-${name}`, passwordHash: hash, role: roles.get(role), status: "ACTIVE", department: null, sessionVersion: 0 });
    }
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    const pageFor = async (name) => {
      const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 } });
      const csrf = await (await context.request.get("/api/auth/csrf")).json();
      await context.request.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, email: people[name].email, password, callbackUrl: `${base}/clients` }, headers: { "X-Auth-Return-Redirect": "1" } });
      const session = await (await context.request.get("/api/auth/session")).json();
      assert.equal(session.user?.id, String(people[name]._id));
      const page = await context.newPage(); page.setDefaultTimeout(30000);
      page.on("pageerror", (err) => pageErrors.push(err.message));
      return page;
    };
    const sales = await pageFor("sales");
    const clientName = `${tag} Brand`;
    const choose = async (scope, label, option) => { await scope.getByRole("combobox", { name: label, exact: true }).click(); await sales.getByRole("option", { name: option, exact: true }).click(); };
    const add = async (scope, name) => { await scope.getByRole("group", { name: "Add a service", exact: true }).getByRole("button", { name }).click(); };
    const card = (scope, name) => scope.locator("li").filter({ hasText: name }).last();
    let client;
    await check("browser creates a client with all six service configurations", async () => {
      await sales.goto("/clients");
      await sales.getByRole("button", { name: "New client", exact: true }).click();
      const dialog = sales.getByRole("dialog");
      await dialog.getByLabel("Company name").fill(clientName);
      await dialog.getByLabel("Contact person").fill("Asha Rao");
      await dialog.getByLabel("Email", { exact: true }).fill(`${tag}-client@example.com`);
      await dialog.getByLabel("Contact designation").fill("Director");
      await add(dialog, /Social Media Marketing/);
      const smm = card(dialog, "Social Media Marketing (SMM)");
      await smm.getByLabel("Number of posters", { exact: true }).fill("12");
      await smm.getByRole("checkbox", { name: "Instagram", exact: true }).check();
      await choose(smm, "Monthly or one-time", "Monthly");
      await smm.getByLabel("Proposed budget", { exact: true }).fill("30000");
      await choose(smm, "Status", "Approved");
      await add(dialog, /Search Engine Marketing/);
      await card(dialog, "Search Engine Marketing (SEM)").getByLabel("Number of campaigns", { exact: true }).fill("3");
      await add(dialog, /Search Engine Optimization/);
      await card(dialog, "Search Engine Optimization (SEO)").getByLabel("Number of target keywords").fill("25");
      await add(dialog, /Website Development/);
      await card(dialog, "Website Development").getByLabel("Number of pages").fill("8");
      await add(dialog, /Video Production/);
      await card(dialog, "Video Production").getByLabel("Language", { exact: true }).fill("English");
      await add(dialog, /Quick Work/);
      await card(dialog, "Quick Work").getByLabel("Work title").fill("Refresh the hero banner");
      await dialog.getByRole("button", { name: "Create client", exact: true }).click();
      await sales.waitForURL(/\/clients\/[a-f\d]{24}$/);
      client = await db.collection("clients").findOne({ name: clientName }); assert.ok(client);
      assert.equal(await db.collection("clientservicerequirements").countDocuments({ client: client._id }), 6);
    });
    await check("client contact, project and history tabs load their persisted data", async () => {
      await sales.getByRole("tab", { name: "Contacts", exact: true }).click();
      await sales.getByText("No additional contacts", { exact: true }).waitFor();
      await sales.getByRole("tab", { name: /^Projects/ }).click();
      await sales.getByText("No projects yet", { exact: true }).waitFor();
      await sales.getByRole("tab", { name: "History", exact: true }).click();
      await sales.getByText(/Client CLT-\d+ created/).waitFor();
    });
    await check("refresh retains every service and the contact designation", async () => {
      await sales.reload();
      await sales.getByText("Director", { exact: true }).waitFor();
      await sales.getByRole("tab", { name: "Service Requirements", exact: true }).click();
      const smm = card(sales, "Social Media Marketing (SMM)");
      await smm.getByRole("button", { expanded: false }).click();
      assert.equal(await smm.getByLabel("Number of posters", { exact: true }).inputValue(), "12");
      const stored = await db.collection("clientservicerequirements").find({ client: client._id }).toArray();
      assert.equal(stored.find((r) => r.serviceType === "SEO").config.targetKeywords, 25);
      assert.equal(stored.find((r) => r.serviceType === "VIDEO").config.language, "English");
    });
    await check("client edit saves requirement changes through the same form", async () => {
      await sales.getByRole("button", { name: "Edit", exact: true }).click();
      const dialog = sales.getByRole("dialog");
      const smm = card(dialog, "Social Media Marketing (SMM)");
      await smm.getByRole("button", { expanded: false }).click();
      await smm.getByLabel("Number of posters", { exact: true }).fill("18");
      await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal((await db.collection("clientservicerequirements").findOne({ client: client._id, serviceType: "SMM" })).config.posters, 18);
    });
    await check("another service can be added after client creation", async () => {
      await add(sales, /Quick Work/);
      const cards = sales.locator("li").filter({ hasText: "Quick Work" });
      await cards.last().getByLabel("Work title").fill("Add a campaign banner");
      const response = sales.waitForResponse((r) => r.request().method() === "PUT" && r.url().endsWith("/requirements"));
      await sales.getByRole("button", { name: "Save requirements", exact: true }).click();
      assert.equal((await response).status(), 200);
      assert.equal(await db.collection("clientservicerequirements").countDocuments({ client: client._id }), 7);
    });
    let projectId;
    await check("approved service converts to a draft with confirmed scope and deliverables", async () => {
      await sales.getByRole("button", { name: "Create project", exact: true }).click();
      const dialog = sales.getByRole("dialog");
      await dialog.getByRole("checkbox", { name: /Social Media Marketing/ }).check();
      await dialog.getByLabel("Confirmed scope").fill("18 posters monthly with reporting");
      await dialog.getByRole("button", { name: "Add deliverable", exact: true }).click();
      await dialog.getByLabel("Deliverable type").fill("Poster");
      await dialog.getByLabel("Quantity", { exact: true }).fill("18");
      await dialog.getByRole("button", { name: "Save project draft", exact: true }).click();
      await sales.waitForURL(/\/projects\/[a-f\d]{24}$/); projectId = sales.url().split("/").pop();
      const p = await db.collection("projects").findOne({ _id: new mongoose.Types.ObjectId(projectId) });
      assert.equal(p.status, "DRAFT"); assert.equal(p.manager, null);
    });
    const pick = async (dialog, label, person) => { await dialog.getByRole("combobox", { name: label, exact: true }).click(); await sales.getByRole("option").filter({ hasText: person.name }).last().click(); };
    await check("Sales nominates primary and supporting PMs and submits handover", async () => {
      await sales.getByRole("button", { name: "Nominate PM team", exact: true }).click();
      const dialog = sales.getByRole("dialog");
      await pick(dialog, "Primary Project Manager", people.pm);
      await pick(dialog, "Supporting Project Managers", people.supporting);
      await sales.keyboard.press("Escape");
      await dialog.getByRole("button", { name: "Save nomination", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await sales.getByRole("button", { name: "Submit handover", exact: true }).click();
      await sales.getByText("Handover submitted", { exact: true }).waitFor();
      const notices = await db.collection("notifications").find({ entityId: new mongoose.Types.ObjectId(projectId) }).toArray();
      assert.ok(notices.some((n) => String(n.recipient) === String(people.pm._id)));
    });
    const pm = await pageFor("pm");
    await check("nominated PM rejects with a reason and Sales sees it", async () => {
      await pm.goto(`/projects/${projectId}`);
      await pm.getByRole("button", { name: "Reject handover", exact: true }).click();
      await pm.getByLabel("Rejection reason").fill("Need the campaign schedule before accepting");
      await pm.getByRole("button", { name: "Confirm rejection", exact: true }).click();
      await pm.getByRole("dialog").waitFor({ state: "hidden" });
      await sales.reload();
      await sales.getByText("Rejection reason: Need the campaign schedule before accepting", { exact: true }).waitFor();
    });
    await check("re-nomination requires a fresh explicit PM acceptance", async () => {
      await sales.getByRole("button", { name: "Nominate PM team", exact: true }).click();
      await sales.getByRole("dialog").getByRole("button", { name: "Save nomination", exact: true }).click();
      await sales.getByRole("dialog").waitFor({ state: "hidden" });
      await pm.reload();
      await pm.getByRole("button", { name: "Accept handover", exact: true }).click();
      await pm.getByText(`Project owner: ${people.pm.name}`, { exact: true }).waitFor();
      if (process.env.TEST_SCREENSHOT_PATH) await pm.screenshot({ path: process.env.TEST_SCREENSHOT_PATH, fullPage: true });
      const p = await db.collection("projects").findOne({ _id: new mongoose.Types.ObjectId(projectId) });
      assert.equal(p.status, "PM_ACCEPTED"); assert.equal(String(p.manager), String(people.pm._id));
      assert.equal(await db.collection("projectmembers").countDocuments({ project: p._id, isActive: true }), 2);
    });
    await check("unauthorized users cannot read the project or act on the handover", async () => {
      const stranger = await pageFor("stranger");
      assert.equal((await stranger.request.get(`/api/projects/${projectId}`)).status(), 404);
      assert.equal((await stranger.request.post(`/api/projects/${projectId}/handover`, { data: { action: "accept" } })).status(), 404);
      await stranger.goto(`/projects/${projectId}`);
      await stranger.getByText("Project not found", { exact: true }).waitFor();
      assert.equal(await stranger.getByRole("button", { name: "Accept handover", exact: true }).count(), 0);
    });
    await check("browser reports no uncaught rendering or hydration errors", async () => { assert.deepEqual(pageErrors, []); });
    console.log(`${checks} onboarding browser checks passed.`);
  } finally {
    if (browser) await browser.close();
    if (db) {
      const clients = await db.collection("clients").find({ createdBy: { $in: ids } }).toArray(); const cids = clients.map((c) => c._id);
      const projects = await db.collection("projects").find({ createdBy: { $in: ids } }).toArray(); const pids = projects.map((p) => p._id);
      for (const collection of ["projectservices", "pmassignments", "projectmembers"]) await db.collection(collection).deleteMany({ project: { $in: pids } });
      for (const collection of ["clientservicerequirements", "clienthistories", "clientcontacts"]) await db.collection(collection).deleteMany({ client: { $in: cids } });
      await db.collection("notifications").deleteMany({ $or: [{ actor: { $in: ids } }, { recipient: { $in: ids } }] });
      await db.collection("auditlogs").deleteMany({ actor: { $in: ids } });
      await db.collection("duplicatereviews").deleteMany({ $or: [{ clientA: { $in: cids } }, { clientB: { $in: cids } }] });
      await db.collection("projects").deleteMany({ _id: { $in: pids } }); await db.collection("clients").deleteMany({ _id: { $in: cids } }); await db.collection("users").deleteMany({ _id: { $in: ids } });
    }
    await mongoose.disconnect();
  }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });

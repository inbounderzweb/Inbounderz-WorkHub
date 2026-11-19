/** Real persistence and rollback checks in a disposable replica set; never uses the configured database. */
import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { CurrentUser } from "@/lib/auth/current-user";
import { ROLE_PERMISSIONS } from "@/lib/permissions";
import type { RoleKey } from "@/lib/constants";
import { createClientSchema, updateClientSchema } from "@/lib/validations/client";
import { createHandoverSchema } from "@/lib/validations/handover";
import { createProjectSchema, projectListQuerySchema } from "@/lib/validations/project";

async function main() {
  // Outside Next, allow its server-only marker while retaining normal React for imported Next helpers.
  const require = createRequire(import.meta.url);
  const markerPath = require.resolve("server-only");
  const marker = new Module(markerPath);
  marker.exports = {}; marker.loaded = true; require.cache[markerPath] = marker;
  const server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  process.env.MONGODB_URI = server.getUri("onboarding_transactions");
  let count = 0;
  const check = async (name: string, work: () => Promise<void>) => { await work(); count++; console.log(`PASS ${name}`); };
  try {
    const { connectDB } = await import("@/lib/db");
    const { getRoleByKey } = await import("@/lib/roles");
    const { Client, ClientHistory, Department, ClientServiceRequirement, PMAssignment, Project, ProjectMember, ProjectService, User } = await import("@/models");
    const { createClient, getClient, updateClient } = await import("@/services/client.service");
    const { createHandover, performHandoverAction } = await import("@/services/handover.service");
    const { listRequirements, syncRequirements } = await import("@/services/requirement.service");
    const { createProject, getProject, listProjects } = await import("@/services/project.service");
    await connectDB();
    await getRoleByKey("SUPER_ADMIN");
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
    const actor = async (key: string, role: RoleKey): Promise<CurrentUser> => {
      const r = await getRoleByKey(role);
      const u = await User.create({ name: key, email: `${key}@example.com`, employeeId: key, role: r.id, passwordHash: "unused", status: "ACTIVE" });
      return { id: String(u._id), name: key, email: u.email, employeeId: key, role, roleName: r.name, roleLevel: r.level, departmentId: null, designation: "", avatarUrl: "", permissions: ROLE_PERMISSIONS[role] };
    };
    const dept = await Department.create({ name: "Transaction Dept", code: "TXD" });
    const departments = [String(dept._id)];
    const sales = await actor("sales", "SALES_EXECUTIVE");
    const pm = await actor("pm", "PROJECT_MANAGER");
    const supporting = await actor("supporting", "PROJECT_MANAGER");
    const coordinator = await actor("coordinator", "EMPLOYEE");
    const smm = { serviceType: "SMM", status: "APPROVED", proposedBudget: 30000, config: { posters: 12, platforms: ["Instagram"], billingCycle: "MONTHLY" } };
    const client = await createClient(sales, createClientSchema.parse({ name: "Transaction Client", contactPerson: "Asha", email: "client@example.com", requirements: [smm] }));
    const requirements = () => listRequirements(sales, client.id);
    const asInput = (r: Awaited<ReturnType<typeof requirements>>[number]) => ({ id: r.id, serviceType: r.serviceType, status: r.status, currency: r.currency, proposedBudget: r.proposedBudget, agencyFee: r.agencyFee, adSpend: r.adSpend, config: r.config });

    await check("client and requirement edits commit together, preserving new contact fields", async () => {
      const [r] = await requirements();
      await updateClient(sales, client.id, updateClientSchema.parse({ contactDesignation: "Director", contactEmail: "asha@example.com", contactPhone: "+919876543210", alternatePhone: "+919876543211", requirements: [{ ...asInput(r), config: { ...r.config, posters: 18 } }] }));
      assert.equal((await requirements())[0].config.posters, 18);
      const saved = await getClient(sales, client.id);
      assert.equal(saved.contactDesignation, "Director"); assert.equal(saved.contactEmail, "asha@example.com"); assert.equal(saved.alternatePhone, "+919876543211");
    });
    await check("invalid requirement aborts the client edit and every history write", async () => {
      const before = await Client.findById(client.id).lean();
      const historyCount = await ClientHistory.countDocuments({ client: client.id });
      await assert.rejects(updateClient(sales, client.id, updateClientSchema.parse({ name: "Must roll back", requirements: [{ ...smm, config: { posters: -1 } }] })));
      assert.equal((await Client.findById(client.id).lean())?.name, before?.name);
      assert.equal(await ClientHistory.countDocuments({ client: client.id }), historyCount);
      assert.equal((await requirements())[0].config.posters, 18);
    });
    const [requirement] = await requirements();
    const body = (extra = {}) => createHandoverSchema.parse({ project: { name: "Transaction project", currency: "INR" }, services: [{ requirementId: requirement.id, confirmedScope: "18 posters per month", approvedBudget: 30000 }], team: { primaryPm: pm.id, supportingPms: [supporting.id], coordinator: coordinator.id }, submit: true, ...extra });
    await check("legacy project creation cannot manufacture an accepted or pending handover", async () => {
      for (const status of ["DRAFT", "HANDOVER_PENDING", "PM_ACCEPTED", "PM_REJECTED"]) {
        await assert.rejects(createProject(pm, createProjectSchema.parse({ name: "Bypass attempt", departments: [String(new mongoose.Types.ObjectId())], status })), /client handover/);
      }
      assert.equal(await Project.countDocuments(), 0);
    });
    await check("different currencies cannot silently become one project currency", async () => {
      await assert.rejects(createHandover(sales, client.id, body({ project: { name: "Wrong currency", currency: "USD" } })));
      assert.equal(await Project.countDocuments(), 0); assert.equal(await ProjectService.countDocuments(), 0);
    });
    await check("coordinator API rejects Sales even when supplied outside the picker", async () => {
      await assert.rejects(createHandover(sales, client.id, body({ team: { primaryPm: pm.id, coordinator: sales.id } })));
      assert.equal(await Project.countDocuments(), 0);
    });
    const handover = await createHandover(sales, client.id, body());
    await check("bulk save cannot edit a requirement used by a project, and aborts client fields too", async () => {
      const r = (await requirements())[0];
      const changed = { ...asInput(r), config: { ...r.config, posters: 99 } };
      await assert.rejects(syncRequirements(sales, client.id, [changed]));
      await assert.rejects(updateClient(sales, client.id, updateClientSchema.parse({ contactDesignation: "Must roll back", requirements: [changed] })));
      assert.equal((await getClient(sales, client.id)).contactDesignation, "Director");
      assert.equal((await requirements())[0].config.posters, 18);
    });
    await check("unchanged linked requirements can be retained while adding a new service", async () => {
      const r = (await requirements())[0];
      const saved = await syncRequirements(sales, client.id, [asInput(r), { serviceType: "WEBSITE", config: { pages: 4 } }]);
      assert.equal(saved.length, 2); assert.equal(saved[0].linkedProject?.id, handover.projectId);
    });
    await check("stale bulk editors cannot remove newer services", async () => {
      await assert.rejects(syncRequirements(sales, client.id, [asInput(requirement)], client.updatedAt));
      assert.equal((await requirements()).length, 2);
    });
    await check("membership write failure rolls back ownership, acceptance, memberships and history", async () => {
      const original = ProjectMember.collection.updateOne;
      let writes = 0;
      ProjectMember.collection.updateOne = async function (...args: Parameters<typeof original>) {
        writes++;
        if (writes === 2) throw new Error("Injected supporting membership failure");
        return original.apply(this, args);
      };
      const historyCount = await ClientHistory.countDocuments({ client: client.id });
      try { await assert.rejects(performHandoverAction(pm, handover.projectId, { action: "accept", departments }), /Injected supporting membership failure/); }
      finally { ProjectMember.collection.updateOne = original; }
      assert.equal((await Project.findById(handover.projectId).lean())?.manager, null);
      assert.equal((await Project.findById(handover.projectId).lean())?.status, "HANDOVER_PENDING");
      assert.equal((await PMAssignment.findOne({ project: handover.projectId, isCurrent: true }).lean())?.status, "PENDING");
      assert.equal(await ProjectMember.countDocuments({ project: handover.projectId }), 0);
      assert.equal(await ClientHistory.countDocuments({ client: client.id }), historyCount);
    });
    await check("acceptance commits primary and supporting ownership together after retry", async () => {
      await performHandoverAction(pm, handover.projectId, { action: "accept", departments });
      assert.equal(String((await Project.findById(handover.projectId).lean())?.manager), pm.id);
      assert.equal(await ProjectMember.countDocuments({ project: handover.projectId, isActive: true }), 3);
      assert.equal((await ProjectMember.findOne({ project: handover.projectId, user: pm.id }).lean())?.projectRole, "MANAGER");
      assert.equal((await ProjectMember.findOne({ project: handover.projectId, user: supporting.id }).lean())?.projectRole, "LEAD");
      assert.equal((await ClientServiceRequirement.findById(requirement.id).lean())?.status, "APPROVED");
    });
    await check("coordinator cannot see aggregate project budget through detail or list APIs", async () => {
      const detail = await getProject(coordinator, handover.projectId);
      assert.equal(detail.budget, null); assert.equal(detail.services[0].approvedBudget, null);
      const list = await listProjects(coordinator, projectListQuerySchema.parse({}));
      assert.ok("items" in list);
      assert.equal(list.items.find((p) => p.id === handover.projectId)?.budget, null);
      await assert.rejects(listRequirements(coordinator, client.id));
    });
    await check("maximum-length rejection reasons persist in assignment and client history", async () => {
      const other = await createClient(sales, createClientSchema.parse({ name: "Reason Length Verification", contactPerson: "Asha", email: "other@example.com", requirements: [smm] }));
      const [r] = await listRequirements(sales, other.id);
      const h = await createHandover(sales, other.id, body({ services: [{ requirementId: r.id, confirmedScope: "Monthly campaign delivery" }] }));
      const reason = "r".repeat(2000);
      await performHandoverAction(pm, h.projectId, { action: "reject", reason });
      assert.equal((await PMAssignment.findOne({ project: h.projectId }).lean())?.rejectionReason, reason);
      const rows = await ClientHistory.find({ client: other.id, action: "PROJECT_HANDOVER" }).lean();
      assert.ok(rows.some((row) => row.changes?.rejectionReason?.to === reason));
    });
    await check("archived projects cannot change handover state", async () => {
      await Project.updateOne({ _id: handover.projectId }, { $set: { isArchived: true } });
      await assert.rejects(performHandoverAction(sales, handover.projectId, { action: "nominate", team: { primaryPm: supporting.id, supportingPms: [], handoverNotes: "" } }), /Unarchive/);
    });
    console.log(`${count} onboarding transaction checks passed.`);
  } finally { await mongoose.disconnect(); await server.stop(); }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });

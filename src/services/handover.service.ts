import "server-only";
import type { ClientSession } from "mongoose";
import type { CurrentUser } from "@/lib/auth/current-user";
import { conflict, forbidden, notFound, unprocessable } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { withTransaction } from "@/lib/transaction";
import { notify } from "@/lib/notify";
import { hasPermission } from "@/lib/permissions";
import { getRoleByKey } from "@/lib/roles";
import { describeDeliverableChanges, mergeDeliverables, type DeliverableRecord } from "@/lib/deliverables";
import { handoverTransition, teamConflicts } from "@/lib/handover";
import { SERVICE_SHORT_LABELS, type PmAssignmentStatus, type ProjectStatus, type ServiceType } from "@/lib/constants";
import type { CreateHandoverInput, HandoverActionInput } from "@/lib/validations/handover";
import { Client, ClientHistory, Department, ClientServiceRequirement, PMAssignment, Project, ProjectMember, ProjectService, User } from "@/models";
import type { HandoverDTO, PmOptionDTO, ProjectServiceDTO } from "@/types/dto";
import { accessContext, canViewProject } from "./access";
import { clientRights } from "./client-access";
import { iso, toUserRef, USER_REF_FIELDS } from "./mappers";
import { generateProjectCode, syncManagerMembership } from "./project-core";
import { oid } from "./scope";

/* eslint-disable @typescript-eslint/no-explicit-any */

const toDate = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const toEndOfDay = (s: string | null | undefined) => (s ? new Date(`${s}T23:59:59.000Z`) : null);
const ev = (actor: string, action: string, note = "") => ({ at: new Date(), actor: oid(actor), action, note });
const isDuplicateKey = (err: unknown) => (err as { code?: number } | null)?.code === 11000;

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

const toOption = (u: any): PmOptionDTO => ({ id: String(u._id), name: u.name, email: u.email ?? "", avatarUrl: u.avatarUrl || null, employeeId: u.employeeId ?? "" });

/**
 * What the handover form may offer. `pms` are active Project Managers (the only people who can be
 * nominated). `coordinators` are other active delivery staff. Sales has no employee-directory access,
 * so this is the narrow list it is allowed to choose from.
 */
export async function listPmOptions(user: CurrentUser): Promise<{ pms: PmOptionDTO[]; coordinators: PmOptionDTO[] }> {
  // Anyone who can open the client form may pick the Project Manager who reviews a client. The wider
  // coordinator list (delivery staff with emails) is only for people who can start a handover.
  if (!hasPermission(user.role, "client:read") && !hasPermission(user.role, "client:create") && !hasPermission(user.role, "project:handover")) throw forbidden();
  const withCoordinators = hasPermission(user.role, "project:handover");
  const [pmRole, ...others] = await Promise.all(["PROJECT_MANAGER", "DEPARTMENT_HEAD", "TEAM_LEADER", "EMPLOYEE"].map((k) => getRoleByKey(k as never)));
  const [pms, coordinators] = await Promise.all([
    User.find({ role: oid(pmRole.id), status: "ACTIVE" }).select("name email avatarUrl employeeId").sort({ name: 1 }).lean(),
    withCoordinators
      ? User.find({ role: { $in: [pmRole, ...others].map((r) => oid(r.id)) }, status: "ACTIVE" }).select("name email avatarUrl employeeId").sort({ name: 1 }).limit(500).lean()
      : Promise.resolve([]),
  ]);
  return { pms: pms.map(toOption), coordinators: coordinators.map(toOption) };
}

async function requirePmRole(ids: string[], field: string) {
  if (!ids.length) return;
  const role = await getRoleByKey("PROJECT_MANAGER");
  const users: any[] = await User.find({ _id: { $in: ids.map(oid) } }).select("name status role").lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  for (const id of ids) {
    const u = byId.get(id);
    if (!u) throw unprocessable("A nominated Project Manager was not found", { [field]: "Not found" });
    if (u.status !== "ACTIVE") throw unprocessable(`${u.name} is inactive`, { [field]: `${u.name} is inactive` });
    if (String(u.role) !== role.id) throw unprocessable(`${u.name} is not a Project Manager`, { [field]: `${u.name} does not have the Project Manager role` });
  }
}

async function requireActiveUser(id: string | null | undefined, field: string) {
  if (!id) return;
  const u: any = await User.findById(id).select("name status role").lean();
  if (!u) throw unprocessable("The coordinator was not found", { [field]: "Not found" });
  if (u.status !== "ACTIVE") throw unprocessable(`${u.name} is inactive`, { [field]: `${u.name} is inactive` });
  const allowed = await Promise.all(["PROJECT_MANAGER", "DEPARTMENT_HEAD", "TEAM_LEADER", "EMPLOYEE"].map((key) => getRoleByKey(key as never)));
  if (!allowed.some((role) => role.id === String(u.role))) throw unprocessable("Choose a coordinator from delivery staff", { [field]: "Choose delivery staff" });
}

async function validateTeam(team: { primaryPm?: string | null; supportingPms?: string[]; coordinator?: string | null }, prefix: string) {
  const conflictMsg = teamConflicts(team);
  if (conflictMsg) throw unprocessable(conflictMsg, { [`${prefix}.supportingPms`]: conflictMsg });
  await requirePmRole(team.primaryPm ? [team.primaryPm] : [], `${prefix}.primaryPm`);
  await requirePmRole(team.supportingPms ?? [], `${prefix}.supportingPms`);
  await requireActiveUser(team.coordinator, `${prefix}.coordinator`);
}

async function adminIds(): Promise<string[]> {
  const admin = await getRoleByKey("SUPER_ADMIN");
  return (await User.find({ role: oid(admin.id), status: "ACTIVE" }).select("_id").lean()).map((u: any) => String(u._id));
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

/** Sales (the client's owner) or an Admin. A PM can never start a handover for themselves. */
function canHandOver(user: CurrentUser, client: { salesOwner?: unknown }): boolean {
  if (!hasPermission(user.role, "project:handover")) return false;
  const rights = clientRights(user, client);
  return rights.level === "FULL" && rights.editRestricted;
}

export async function createHandover(user: CurrentUser, clientId: string, input: CreateHandoverInput): Promise<{ projectId: string; code: string; status: ProjectStatus }> {
  if (!hasPermission(user.role, "project:handover")) throw forbidden();
  const client: any = await Client.findById(clientId).lean();
  if (!client || !canHandOver(user, client)) throw notFound("Client not found");
  if (client.status === "ARCHIVED") throw unprocessable("This client is archived. Reactivate it before starting a project.");

  // Only explicitly selected, approved, not-yet-converted requirements may become scope.
  const reqIds = input.services.map((s) => s.requirementId);
  if (new Set(reqIds).size !== reqIds.length) throw unprocessable("A requirement was selected twice", { services: "Duplicate requirement" });
  const reqs: any[] = await ClientServiceRequirement.find({ _id: { $in: reqIds.map(oid) }, client: client._id, isActive: true }).lean();
  const reqById = new Map(reqs.map((r) => [String(r._id), r]));
  const already = new Set((await ProjectService.find({ requirement: { $in: reqIds.map(oid) }, isActive: true }).select("requirement").lean()).map((s: any) => String(s.requirement)));
  const errors: Record<string, string> = {};
  const deliverables: ReturnType<typeof mergeDeliverables>["next"][] = [];
  input.services.forEach((s, i) => {
    const r = reqById.get(s.requirementId);
    if (!r) errors[`services.${i}.requirementId`] = "This requirement does not belong to the client";
    else if (r.status !== "APPROVED") errors[`services.${i}.requirementId`] = "Only approved requirements can be converted to project scope";
    else if (already.has(s.requirementId)) errors[`services.${i}.requirementId`] = "This requirement is already part of a project";
    if (s.adSpend !== null && s.adSpend !== undefined && r && !["SEM", "SMM"].includes(r.serviceType)) errors[`services.${i}.adSpend`] = "Advertising spend applies to SEM and SMM only";
    const merged = mergeDeliverables([], s.deliverables.map((d) => ({ type: d.type, quantity: d.quantity, specifications: d.specifications })));
    for (const [k, m] of Object.entries(merged.errors)) errors[k.replace(/^deliverables/, `services.${i}.deliverables`)] = m;
    deliverables.push(merged.next);
  });
  if (Object.keys(errors).length) throw unprocessable("Some selected services need attention", errors);
  await validateTeam(input.team, "team");

  const submit = input.submit;
  const status: ProjectStatus = submit ? "HANDOVER_PENDING" : "DRAFT";
  const budgets = input.services.map((s) => s.approvedBudget).filter((n): n is number => typeof n === "number");
  const code = await generateProjectCode();
  const now = new Date();

  let created: { project: any; assignment: any };
  try {
    created = await withTransaction(async (session) => {
      // Serialize conversion with requirement edits before reading the scope snapshot.
      const locked = await Client.updateOne({ _id: client._id, status: { $ne: "ARCHIVED" }, salesOwner: client.salesOwner }, { $set: { updatedBy: oid(user.id) } }, { session });
      if (!locked.matchedCount) throw conflict("The client changed. Reload before converting requirements.");
      const currentReqs: any[] = await ClientServiceRequirement.find({ _id: { $in: reqIds.map(oid) }, client: client._id, isActive: true, status: "APPROVED" }).session(session ?? null).lean();
      if (currentReqs.length !== reqIds.length) throw conflict("A selected requirement changed. Reload before converting it.");
      for (const r of currentReqs) {
        if (r.currency !== input.project.currency) throw unprocessable("Project currency must match every selected requirement. Create separate projects for different currencies.", { "project.currency": "Must match the selected requirements" });
        reqById.set(String(r._id), r);
      }
      const [project] = await Project.create(
        [{
          code, name: input.project.name, client: client.name, clientRef: client._id,
          description: input.project.description, notes: input.project.notes, status, priority: input.project.priority,
          currency: input.project.currency, manager: null, departments: [],
          budget: budgets.length ? budgets.reduce((a, b) => a + b, 0) : null,
          startDate: toDate(input.project.startDate), endDate: toEndOfDay(input.project.endDate), createdBy: oid(user.id),
        }],
        { session }
      );
      await ProjectService.create(
        input.services.map((s, i) => {
          const r = reqById.get(s.requirementId);
          return {
            project: project._id, client: client._id, requirement: r._id, serviceType: r.serviceType,
            confirmedScope: s.confirmedScope, deliverables: deliverables[i], currency: input.project.currency,
            approvedBudget: s.approvedBudget, agencyFee: s.agencyFee, adSpend: s.adSpend, estimatedHours: s.estimatedHours,
            startDate: toDate(s.startDate), endDate: toEndOfDay(s.endDate), createdBy: oid(user.id),
            requirementSnapshot: {
              summary: r.summary, config: r.config, status: r.status, currency: r.currency,
              proposedBudget: r.proposedBudget ?? null, adSpend: r.adSpend ?? null, agencyFee: r.agencyFee ?? null, capturedAt: now,
            },
          };
        }),
        { session, ordered: true }
      );
      const [assignment] = await PMAssignment.create(
        [{
          project: project._id, client: client._id, status: submit ? "PENDING" : "DRAFT", isCurrent: true, sequence: 1,
          primaryPm: input.team.primaryPm ? oid(input.team.primaryPm) : null,
          supportingPms: (input.team.supportingPms ?? []).map(oid),
          coordinator: input.team.coordinator ? oid(input.team.coordinator) : null,
          handoverNotes: input.team.handoverNotes, proposedHandoverDate: toDate(input.team.proposedHandoverDate),
          nominatedBy: oid(user.id), submittedAt: submit ? now : null,
          events: [ev(user.id, "created"), ...(submit ? [ev(user.id, "submitted")] : [])],
        }],
        { session }
      );
      await ClientHistory.create([{
        client: client._id, actor: oid(user.id), action: "PROJECT_HANDOVER",
        summary: `${submit ? "Submitted" : "Drafted"} project ${project.code} (${project.name}) from ${input.services.length} approved service(s)`,
        changes: { project: { from: null, to: project.code }, services: { from: null, to: input.services.map((s) => SERVICE_SHORT_LABELS[reqById.get(s.requirementId).serviceType as ServiceType]).join(", ") } },
      }], { session });
      return { project, assignment };
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict("One of the selected requirements was just added to another project. Reload and try again.");
    throw err;
  }

  const { project } = created;
  await recordAudit({ actorId: user.id, action: "project.handover_create", entityType: "Project", entityId: project._id, summary: `Created project ${project.code} for ${client.clientCode} from ${input.services.length} approved service(s) (${submit ? "submitted" : "draft"})` });
  if (submit) await announceNomination(user, project, client, created.assignment, "submitted");
  return { projectId: String(project._id), code: project.code, status };
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

async function announceNomination(user: CurrentUser, project: any, client: any, a: any, kind: "submitted" | "nominated") {
  const link = `/projects/${project._id}`;
  await notify({
    recipients: [a.primaryPm], actorId: user.id, type: "PROJECT", link, entityType: "Project", entityId: project._id,
    title: "Project handover awaiting your response",
    message: `${user.name} ${kind === "submitted" ? "submitted" : "nominated you for"} ${project.name} (${project.code}) for ${client.name}. Review the scope and accept or reject the assignment.`,
  });
  await notify({
    recipients: [...(a.supportingPms ?? []), a.coordinator], actorId: user.id, type: "PROJECT", link, entityType: "Project", entityId: project._id,
    title: "You were proposed for a project handover",
    message: `${project.name} (${project.code}) is waiting for the primary Project Manager to accept. You will be added once they do.`,
  });
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

/** Financial detail of a handover is for Admin, the Sales side and the PMs involved; not for other viewers. */
function seesMoney(user: CurrentUser, project: any, client: any, a: any | null): boolean {
  if (user.role === "SUPER_ADMIN") return true;
  const me = user.id;
  if (user.role === "SALES_EXECUTIVE") return String(client?.salesOwner ?? "") === me || String(project.createdBy ?? "") === me;
  if (user.role === "PROJECT_MANAGER") {
    return String(project.manager ?? "") === me || [a?.primaryPm, ...(a?.supportingPms ?? [])].some((x) => x && String(x._id ?? x) === me);
  }
  return false;
}

const toServiceDTO = (s: any, money: boolean): ProjectServiceDTO => ({
  id: String(s._id), requirementId: String(s.requirement), serviceType: s.serviceType, confirmedScope: s.confirmedScope,
  deliverables: (s.deliverables ?? []).map((d: any) => ({ id: String(d._id), type: d.type, quantity: d.quantity, specifications: d.specifications ?? "", completedQuantity: d.completedQuantity ?? 0, verifiedQuantity: d.verifiedQuantity ?? 0 })),
  currency: s.currency, approvedBudget: money ? s.approvedBudget ?? null : null, agencyFee: money ? s.agencyFee ?? null : null, adSpend: money ? s.adSpend ?? null : null,
  estimatedHours: s.estimatedHours ?? null, startDate: iso(s.startDate), endDate: iso(s.endDate), status: s.status,
  requirementSummary: s.requirementSnapshot?.summary ?? "",
});

/** Handover and confirmed services of a project the viewer can already see. Null handover for legacy projects. */
export async function loadHandoverView(user: CurrentUser, project: any): Promise<{ handover: HandoverDTO | null; services: ProjectServiceDTO[]; clientRef: { id: string; clientCode: string; name: string } | null }> {
  const [services, rows, client] = await Promise.all([
    ProjectService.find({ project: project._id, isActive: true }).sort({ createdAt: 1 }).lean() as Promise<any[]>,
    PMAssignment.find({ project: project._id }).sort({ sequence: -1 }).populate("primaryPm supportingPms coordinator nominatedBy respondedBy", USER_REF_FIELDS).populate("events.actor", USER_REF_FIELDS).lean() as Promise<any[]>,
    project.clientRef ? (Client.findById(project.clientRef).select("clientCode name salesOwner").lean() as Promise<any>) : Promise.resolve(null),
  ]);
  const current = rows.find((r) => r.isCurrent) ?? null;
  const money = seesMoney(user, project, client, current);
  const clientRef = client && (user.role === "SUPER_ADMIN" || user.role === "SALES_EXECUTIVE" || user.role === "PROJECT_MANAGER" || project.clientRef)
    ? { id: String(client._id), clientCode: client.clientCode, name: client.name } : null;
  if (!current) return { handover: null, services: services.map((s) => toServiceDTO(s, money)), clientRef };

  const nominator = hasPermission(user.role, "project:handover") && canHandOver(user, client ?? {});
  const myPmTurn = current.status === "PENDING" && user.role === "PROJECT_MANAGER" && String(current.primaryPm?._id ?? "") === user.id;
  const handover: HandoverDTO = {
    assignmentId: String(current._id), status: current.status, sequence: current.sequence,
    primaryPm: toUserRef(current.primaryPm), supportingPms: (current.supportingPms ?? []).map(toUserRef).filter(Boolean) as any, coordinator: toUserRef(current.coordinator),
    handoverNotes: current.handoverNotes ?? "", proposedHandoverDate: iso(current.proposedHandoverDate),
    nominatedBy: toUserRef(current.nominatedBy), submittedAt: iso(current.submittedAt), respondedAt: iso(current.respondedAt), respondedBy: toUserRef(current.respondedBy),
    rejectionReason: current.rejectionReason ?? "",
    history: (current.events ?? []).map((e: any) => ({ at: iso(e.at)!, actor: toUserRef(e.actor), action: e.action, note: e.note ?? "" })),
    previous: rows.filter((r) => !r.isCurrent).map((r) => ({ primaryPm: toUserRef(r.primaryPm), status: r.status, rejectionReason: r.rejectionReason ?? "", respondedAt: iso(r.respondedAt) })),
    can: {
      respond: !project.isArchived && myPmTurn,
      submit: !project.isArchived && nominator && current.status === "DRAFT" && !!current.primaryPm,
      nominate: !project.isArchived && nominator && project.status !== "CANCELLED" && ["DRAFT", "PENDING", "REJECTED"].includes(current.status),
      revise: !project.isArchived && myPmTurn,
    },
  };
  return { handover, services: services.map((s) => toServiceDTO(s, money)), clientRef };
}

export async function getHandover(user: CurrentUser, projectId: string) {
  if (!hasPermission(user.role, "project:read")) throw forbidden();
  const project: any = await Project.findById(projectId).lean();
  if (!project || !canViewProject(await accessContext(user), project)) throw notFound("Project not found");
  return loadHandoverView(user, project);
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

async function loadForAction(user: CurrentUser, projectId: string) {
  if (!hasPermission(user.role, "project:read")) throw forbidden();
  const project: any = await Project.findById(projectId).lean();
  if (!project || !canViewProject(await accessContext(user), project)) throw notFound("Project not found");
  const current: any = await PMAssignment.findOne({ project: project._id, isCurrent: true }).lean();
  if (!current) throw unprocessable("This project did not come through a Sales handover");
  if (project.isArchived) throw conflict("Unarchive this project before changing its handover");
  const client: any = await Client.findById(current.client).select("clientCode name salesOwner").lean();
  return { project, current, client };
}

function nextOrFail(action: Parameters<typeof handoverTransition>[0], project: any, current: any) {
  const t = handoverTransition(action, project.status, current.status as PmAssignmentStatus);
  if ("error" in t) throw conflict(t.error);
  return t;
}

export async function performHandoverAction(user: CurrentUser, projectId: string, input: HandoverActionInput) {
  const { project, current, client } = await loadForAction(user, projectId);
  switch (input.action) {
    case "submit": return submit(user, project, current, client);
    case "nominate": return nominate(user, project, current, client, input.team);
    case "accept": return accept(user, project, current, client, input.departments);
    case "reject": return reject(user, project, current, client, input.reason);
    case "revise": return revise(user, project, current, client, input);
  }
}

function assertNominator(user: CurrentUser, client: any) {
  if (!canHandOver(user, client)) throw forbidden("Only the client's Sales owner or an Admin can do this");
}

async function handoverHistory(user: CurrentUser, project: any, current: any, action: string, session?: ClientSession, reason = "") {
  await ClientHistory.create([{ client: current.client, actor: oid(user.id), action: "PROJECT_HANDOVER", summary: `${project.code}: ${action}`, reason: reason.slice(0, 1000), changes: { projectStatus: { from: project.status, to: action }, ...(reason ? { rejectionReason: { from: null, to: reason } } : {}) } }], { session });
}

async function submit(user: CurrentUser, project: any, current: any, client: any) {
  assertNominator(user, client);
  const t = nextOrFail("submit", project, current);
  if (!current.primaryPm) throw unprocessable("Nominate a primary Project Manager before submitting", { primaryPm: "Select the primary Project Manager" });
  await validateTeam({ primaryPm: String(current.primaryPm), supportingPms: (current.supportingPms ?? []).map(String), coordinator: current.coordinator ? String(current.coordinator) : null }, "team");
  await withTransaction(async (session) => {
    const a = await PMAssignment.findOneAndUpdate(
      { _id: current._id, isCurrent: true, status: "DRAFT" },
      { $set: { status: t.assignment, submittedAt: new Date() }, $push: { events: ev(user.id, "submitted") } },
      { session, returnDocument: "after" }
    );
    const p = await Project.findOneAndUpdate({ _id: project._id, status: "DRAFT" }, { $set: { status: t.project } }, { session, returnDocument: "after" });
    if (!a || !p) throw conflict("This handover was already submitted");
    await handoverHistory(user, project, current, t.project, session);
  });
  await recordAudit({ actorId: user.id, action: "project.handover_submit", entityType: "Project", entityId: project._id, summary: `Submitted ${project.code} to the nominated Project Manager` });
  await announceNomination(user, project, client, current, "submitted");
  return { status: t.project };
}

async function nominate(user: CurrentUser, project: any, current: any, client: any, team: NonNullable<Extract<HandoverActionInput, { action: "nominate" }>["team"]>) {
  assertNominator(user, client);
  const t = nextOrFail("nominate", project, current);
  await validateTeam(team, "team");
  const fields = {
    primaryPm: oid(team.primaryPm), supportingPms: (team.supportingPms ?? []).map(oid), coordinator: team.coordinator ? oid(team.coordinator) : null,
    handoverNotes: team.handoverNotes ?? "", proposedHandoverDate: toDate(team.proposedHandoverDate),
  };
  const previousPm = current.primaryPm ? String(current.primaryPm) : null;
  let fresh: any = current;

  await withTransaction(async (session: ClientSession | undefined) => {
    if (current.status === "DRAFT") {
      // Still a draft: the same nomination is edited in place.
      const a = await PMAssignment.findOneAndUpdate({ _id: current._id, isCurrent: true, status: "DRAFT" }, { $set: { ...fields, nominatedBy: oid(user.id) }, $push: { events: ev(user.id, "nominated", `Primary PM updated`) } }, { session, returnDocument: "after" });
      if (!a) throw conflict("The handover changed while you were editing. Reload and try again.");
      fresh = a;
      await handoverHistory(user, project, current, "PM nominated", session);
      return;
    }
    // A pending or rejected nomination is closed out (history kept) and a new one takes its place.
    const closed = await PMAssignment.findOneAndUpdate(
      { _id: current._id, isCurrent: true, status: current.status },
      { $set: { isCurrent: false, ...(current.status === "PENDING" ? { status: "SUPERSEDED", respondedAt: new Date(), respondedBy: oid(user.id) } : {}) }, $push: { events: ev(user.id, "replaced", "A different Project Manager was nominated") } },
      { session }
    );
    if (!closed) throw conflict("Someone else already changed the nomination. Reload and try again.");
    const [a] = await PMAssignment.create(
      [{ project: project._id, client: current.client, status: "PENDING", isCurrent: true, sequence: (current.sequence ?? 1) + 1, ...fields, nominatedBy: oid(user.id), submittedAt: new Date(), events: [ev(user.id, "nominated"), ev(user.id, "submitted")] }],
      { session }
    );
    const p = await Project.findOneAndUpdate({ _id: project._id, status: { $in: ["PM_REJECTED", "HANDOVER_PENDING"] } }, { $set: { status: t.project } }, { session });
    if (!p) throw conflict("This project can no longer be re-nominated");
    fresh = a;
    await handoverHistory(user, project, current, t.project, session);
  }).catch((err) => { throw isDuplicateKey(err) ? conflict("Someone else already changed the nomination. Reload and try again.") : err; });

  await recordAudit({ actorId: user.id, action: "project.handover_nominate", entityType: "Project", entityId: project._id, summary: `Nominated a Project Manager for ${project.code}${current.status === "REJECTED" ? " after a rejection" : ""}` });
  if (fresh.status === "PENDING") {
    await announceNomination(user, project, client, fresh, "nominated");
    if (previousPm && previousPm !== String(team.primaryPm) && current.status === "PENDING") {
      await notify({ recipients: [previousPm], actorId: user.id, type: "PROJECT", link: `/projects/${project._id}`, entityType: "Project", entityId: project._id, title: "Project handover reassigned", message: `${project.name} (${project.code}) was assigned to a different Project Manager. No action is needed from you.` });
    }
  }
  return { status: t.project };
}

async function accept(user: CurrentUser, project: any, current: any, client: any, departmentIds: string[]) {
  if (user.role !== "PROJECT_MANAGER" || String(current.primaryPm ?? "") !== user.id) throw forbidden("Only the nominated primary Project Manager can accept this handover");
  const t = nextOrFail("accept", project, current);
  // The departments the Project Manager picks are the ones that will deliver this work and get told about it.
  const ids = [...new Set(departmentIds)];
  const depts: any[] = await Department.find({ _id: { $in: ids.map(oid) } }).select("name status head teamLeaders").lean();
  if (depts.length !== ids.length) throw unprocessable("A selected department was not found", { departments: "Department not found" });
  const inactive = depts.find((d) => d.status !== "ACTIVE");
  if (inactive) throw unprocessable(`${inactive.name} is not active`, { departments: `${inactive.name} is not active` });
  await validateTeam({ primaryPm: user.id, supportingPms: (current.supportingPms ?? []).map(String), coordinator: current.coordinator ? String(current.coordinator) : null }, "team");
  const extras = [
    ...(current.supportingPms ?? []).map((id: any) => ({ user: id, role: "LEAD" as const })),
    ...(current.coordinator ? [{ user: current.coordinator, role: "MEMBER" as const }] : []),
  ];
  await withTransaction(async (session) => {
    // Compare-and-set on the nomination first: exactly one caller can win, however many tabs or retries race.
    const a = await PMAssignment.findOneAndUpdate(
      { _id: current._id, isCurrent: true, status: "PENDING", primaryPm: oid(user.id) },
      { $set: { status: t.assignment, respondedAt: new Date(), respondedBy: oid(user.id) }, $push: { events: ev(user.id, "accepted") } },
      { session, returnDocument: "after" }
    );
    if (!a) throw conflict("This handover is no longer waiting for your response");
    const p = await Project.findOneAndUpdate({ _id: project._id, status: "HANDOVER_PENDING", manager: null }, { $set: { manager: oid(user.id), status: t.project, departments: ids.map(oid) } }, { session, returnDocument: "after" });
    if (!p) throw conflict("This project already has an owner");
    await handoverHistory(user, project, current, t.project, session);
    // Approval is what onboards the client: a prospect becomes an active client.
    const onboarded = await Client.updateOne({ _id: current.client, status: "PROSPECT" }, { $set: { status: "ACTIVE", updatedBy: oid(user.id) } }, { session });
    if (onboarded.modifiedCount) {
      await ClientHistory.create([{ client: current.client, actor: oid(user.id), action: "PROJECT_HANDOVER", summary: `Client onboarded: ${user.name} approved ${project.code}`, changes: { status: { from: "PROSPECT", to: "ACTIVE" }, departments: { from: null, to: depts.map((d) => d.name).join(", ") } } }], { session });
    }

    await syncManagerMembership(project._id, oid(user.id), user.id, session);
    for (const e of extras) {
      const u: any = await User.findById(e.user).select("department").session(session ?? null).lean();
      await ProjectMember.updateOne(
        { project: project._id, user: e.user },
        { $set: { projectRole: e.role, isActive: true, leftAt: null, department: u?.department ?? null }, $setOnInsert: { joinedAt: new Date(), addedBy: oid(user.id) } },
        { upsert: true, session }
      );
    }
  });
  await recordAudit({ actorId: user.id, action: "project.handover_accept", entityType: "Project", entityId: project._id, summary: `${user.name} accepted the handover of ${project.code} and became its manager` });
  const link = `/projects/${project._id}`;
  const extraUsers = extras.map((e) => e.user);
  await notify({ recipients: [current.nominatedBy, client?.salesOwner, ...(await adminIds())], actorId: user.id, type: "PROJECT", link, entityType: "Project", entityId: project._id, title: "Handover approved, client onboarded", message: `${user.name} approved ${project.name} (${project.code}). ${client?.name ?? "The client"} is now onboarded and ${depts.map((d) => d.name).join(", ")} ${depts.length === 1 ? "has" : "have"} been notified.` });
  await notify({ recipients: extraUsers, actorId: user.id, type: "PROJECT", link, entityType: "Project", entityId: project._id, title: "Added to a project", message: `${user.name} accepted ${project.name} (${project.code}). You are on its management team.` });
  // Only the departments the Project Manager selected hear about it: their head and team leaders.
  const services: any[] = await ProjectService.find({ project: project._id, isActive: true }).select("serviceType deliverables").lean();
  const work = services.map((s) => `${SERVICE_SHORT_LABELS[s.serviceType as ServiceType]}${s.deliverables?.length ? ` (${s.deliverables.map((d: any) => `${d.quantity} ${d.type}`).join(", ")})` : ""}`).join("; ");
  for (const d of depts) {
    await notify({
      recipients: [d.head, ...(d.teamLeaders ?? [])], actorId: user.id, type: "PROJECT", link, entityType: "Project", entityId: project._id,
      title: `New client onboarded for ${d.name}`,
      message: `${client?.name ?? "A client"} · ${project.name} (${project.code}) was approved by ${user.name}. Work: ${work || "see the project"}.`,
    });
  }
  return { status: t.project };
}

const nullable = (v: unknown) => (v === "" || v === undefined ? null : (v as number | null));

/**
 * The primary Project Manager corrects the confirmed scope (poster counts, budget and so on) before
 * approving. The reason is mandatory and lands in the assignment history, the client history and the
 * Sales team's notifications, so Sales can see exactly what changed and why.
 */
async function revise(user: CurrentUser, project: any, current: any, client: any, input: Extract<HandoverActionInput, { action: "revise" }>) {
  if (user.role !== "PROJECT_MANAGER" || String(current.primaryPm ?? "") !== user.id) throw forbidden("Only the nominated primary Project Manager can edit this handover");
  nextOrFail("revise", project, current);
  const rows: any[] = await ProjectService.find({ project: project._id, isActive: true }).lean();
  const byId = new Map(rows.map((r) => [String(r._id), r]));
  const errors: Record<string, string> = {};
  const changes: string[] = [];
  const updates: { id: any; set: Record<string, unknown> }[] = [];

  input.services.forEach((edit, i) => {
    const row = byId.get(edit.id);
    if (!row) { errors[`services.${i}.id`] = "This service is not part of the project"; return; }
    const name = SERVICE_SHORT_LABELS[row.serviceType as ServiceType];
    const set: Record<string, unknown> = {};
    if (edit.confirmedScope !== undefined && edit.confirmedScope !== row.confirmedScope) { set.confirmedScope = edit.confirmedScope; changes.push(`${name}: scope updated`); }
    if (edit.deliverables !== undefined) {
      const before: DeliverableRecord[] = (row.deliverables ?? []).map((d: any) => ({ id: String(d._id), type: d.type, quantity: d.quantity, specifications: d.specifications ?? "", completedQuantity: d.completedQuantity ?? 0, verifiedQuantity: d.verifiedQuantity ?? 0 }));
      const merged = mergeDeliverables(before, edit.deliverables.map((d) => ({ id: d.id ?? null, type: d.type, quantity: d.quantity, specifications: d.specifications })));
      for (const [k, m] of Object.entries(merged.errors)) errors[k.replace(/^deliverables/, `services.${i}.deliverables`)] = m;
      const diff = describeDeliverableChanges(before, merged.next);
      if (diff.length) {
        set.deliverables = merged.next.map((d) => ({ ...(d.id ? { _id: oid(d.id) } : {}), type: d.type, quantity: d.quantity, specifications: d.specifications, completedQuantity: d.completedQuantity, verifiedQuantity: d.verifiedQuantity }));
        changes.push(...diff.map((d) => `${name}: ${d}`));
      }
    }
    for (const [key, label] of [["approvedBudget", "approved budget"], ["agencyFee", "agency fee"], ["adSpend", "advertising spend"], ["estimatedHours", "estimated hours"]] as const) {
      if ((edit as any)[key] === undefined) continue;
      const next = nullable((edit as any)[key]);
      if (next !== (row[key] ?? null)) { set[key] = next; changes.push(`${name}: ${label} ${row[key] ?? "not set"} → ${next ?? "not set"}`); }
    }
    if (Object.keys(set).length) updates.push({ id: row._id, set });
  });
  if (Object.keys(errors).length) throw unprocessable("Some changes need attention", errors);
  if (!updates.length) throw unprocessable("Nothing was changed", { services: "Edit at least one value before saving" });

  const summary = changes.join("; ").slice(0, 1200);
  await withTransaction(async (session) => {
    const a = await PMAssignment.findOneAndUpdate(
      { _id: current._id, isCurrent: true, status: "PENDING", primaryPm: oid(user.id) },
      { $push: { events: ev(user.id, "edited", `${input.reason} — Changes: ${summary}`.slice(0, 2000)) } },
      { session }
    );
    if (!a) throw conflict("This handover is no longer waiting for your response");
    for (const u of updates) await ProjectService.updateOne({ _id: u.id, isActive: true }, { $set: u.set }, { session });
    await ClientHistory.create([{ client: current.client, actor: oid(user.id), action: "PROJECT_HANDOVER", summary: `${project.code}: Project Manager edited the scope`, reason: input.reason.slice(0, 1000), changes: { scope: { from: null, to: summary } } }], { session });
  });
  await recordAudit({ actorId: user.id, action: "project.handover_revise", entityType: "Project", entityId: project._id, summary: `${user.name} edited the scope of ${project.code}: ${summary.slice(0, 300)}. Reason: ${input.reason.slice(0, 200)}` });
  await notify({
    recipients: [current.nominatedBy, client?.salesOwner], actorId: user.id, type: "PROJECT", link: `/projects/${project._id}`, entityType: "Project", entityId: project._id,
    title: "Project Manager edited the project scope",
    message: `${user.name} changed ${project.name} (${project.code}). Reason: ${input.reason.slice(0, 200)}. Changes: ${summary.slice(0, 300)}`,
  });
  return { status: project.status as ProjectStatus };
}

async function reject(user: CurrentUser, project: any, current: any, client: any, reason: string) {
  if (user.role !== "PROJECT_MANAGER" || String(current.primaryPm ?? "") !== user.id) throw forbidden("Only the nominated primary Project Manager can respond to this handover");
  const t = nextOrFail("reject", project, current);
  await withTransaction(async (session) => {
    const a = await PMAssignment.findOneAndUpdate(
      { _id: current._id, isCurrent: true, status: "PENDING", primaryPm: oid(user.id) },
      { $set: { status: t.assignment, respondedAt: new Date(), respondedBy: oid(user.id), rejectionReason: reason }, $push: { events: ev(user.id, "rejected", reason) } },
      { session, returnDocument: "after" }
    );
    if (!a) throw conflict("This handover is no longer waiting for your response");
    const p = await Project.findOneAndUpdate({ _id: project._id, status: "HANDOVER_PENDING" }, { $set: { status: t.project } }, { session });
    if (!p) throw conflict("This handover was already resolved");
    // The project is cancelled: its services stop holding the requirements, so Sales can submit them again.
    await ProjectService.updateMany({ project: project._id, isActive: true }, { $set: { isActive: false, status: "CANCELLED" } }, { session });
    await handoverHistory(user, project, current, t.project, session, reason);
  });
  await recordAudit({ actorId: user.id, action: "project.handover_reject", entityType: "Project", entityId: project._id, summary: `${user.name} rejected the handover of ${project.code}: ${reason.slice(0, 200)}` });
  await notify({ recipients: [current.nominatedBy, client?.salesOwner, ...(await adminIds())], actorId: user.id, type: "PROJECT", link: `/projects/${project._id}`, entityType: "Project", entityId: project._id, title: "Handover rejected, project cancelled", message: `${user.name} rejected ${project.name} (${project.code}) and the project was cancelled: ${reason.slice(0, 200)}. No department was notified. You can create a new project from the approved requirements.` });
  return { status: t.project };
}


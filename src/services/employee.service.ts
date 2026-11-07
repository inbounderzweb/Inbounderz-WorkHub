import "server-only";
import bcrypt from "bcryptjs";
import type { Types } from "mongoose";
import type { z } from "zod";
import type { CurrentUser } from "@/lib/auth/current-user";
import { ApiError, badRequest, conflict, escapeRegex, forbidden, notFound, paginate, unprocessable } from "@/lib/api";
import { recordAudit, diffFields } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { getRoleById, getRoleByKey, getRoleMaps } from "@/lib/roles";
import { ASSIGNABLE_ROLES, hasPermission } from "@/lib/permissions";
import { CLOSED_TASK_STATUSES, OPEN_TASK_STATUSES, roleName, type RoleKey, type UserStatus } from "@/lib/constants";
import type {
  createEmployeeSchema,
  employeeListQuerySchema,
  updateEmployeeSchema,
} from "@/lib/validations/employee";
import { Department, nextSequence, ProjectMember, Task, User } from "@/models";
import type { EmployeeDetailDTO, EmployeeDTO, EmployeeOptionDTO, Paginated } from "@/types/dto";
import { employeeVisibilityFilter, includesId, managedDepartmentIds, oid, type Filter } from "./scope";
import { DEPT_REF_FIELDS, iso, toDepartmentRef, toTaskSummary, toUserRef, USER_REF_FIELDS } from "./mappers";

/* eslint-disable @typescript-eslint/no-explicit-any */

const BCRYPT_ROUNDS = 12;

type CreateInput = z.output<typeof createEmployeeSchema>;
type UpdateInput = z.output<typeof updateEmployeeSchema>;
type ListQuery = z.output<typeof employeeListQuerySchema>;

const toDate = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const nullIfEmpty = (s: string | null | undefined) => (s ? s : null);

async function toEmployeeDTO(u: any): Promise<EmployeeDTO> {
  const role = await getRoleById(u.role);
  return {
    id: u._id.toString(),
    name: u.name,
    email: u.email,
    phone: u.phone ?? "",
    employeeId: u.employeeId,
    designation: u.designation ?? "",
    avatarUrl: u.avatarUrl ?? "",
    role: role ? { key: role.key, name: role.name } : null,
    department: toDepartmentRef(u.department),
    reportingManager: toUserRef(u.reportingManager),
    joiningDate: iso(u.joiningDate),
    status: u.status as UserStatus,
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: iso(u.createdAt)!,
    updatedAt: iso(u.updatedAt)!,
  };
}

/* ------------------------------------------------------------------ */
/* Authorization helpers                                               */
/* ------------------------------------------------------------------ */

type TargetLike = { _id: Types.ObjectId; role: Types.ObjectId; department?: Types.ObjectId | null };

/** Can `actor` edit/activate the given employee? */
async function canManage(actor: CurrentUser, target: TargetLike): Promise<boolean> {
  if (actor.role === "SUPER_ADMIN") return true;
  if (!hasPermission(actor.role, "employee:update")) return false;
  if (target._id.toString() === actor.id) return false; // self-service goes through /profile
  const targetRole = await getRoleById(target.role);
  if (!targetRole || !ASSIGNABLE_ROLES[actor.role].includes(targetRole.key)) return false;
  const depts = await managedDepartmentIds(actor);
  return includesId(depts, target.department);
}

async function activeSuperAdminCount(): Promise<number> {
  const sa = await getRoleByKey("SUPER_ADMIN");
  return User.countDocuments({ role: oid(sa.id), status: "ACTIVE" });
}

/** Validates department/manager references against the actor's scope. */
async function validateRefs(
  actor: CurrentUser,
  input: { department?: string | null; reportingManager?: string | null },
  targetId?: string
) {
  const fieldErrors: Record<string, string> = {};

  if (input.department) {
    const dept = await Department.findById(input.department).select("status").lean();
    if (!dept) fieldErrors.department = "Department not found";
    else if (dept.status !== "ACTIVE") fieldErrors.department = "Department is archived";
    else {
      const managed = await managedDepartmentIds(actor);
      if (!includesId(managed, dept._id)) fieldErrors.department = "You can only assign your own departments";
    }
  } else if (input.department !== undefined && actor.role !== "SUPER_ADMIN") {
    fieldErrors.department = "Department is required";
  }

  if (input.reportingManager) {
    if (targetId && input.reportingManager === targetId) {
      fieldErrors.reportingManager = "An employee cannot report to themselves";
    } else {
      const mgr = await User.findById(input.reportingManager).select("status reportingManager").lean();
      if (!mgr) fieldErrors.reportingManager = "Manager not found";
      else if (mgr.status !== "ACTIVE") fieldErrors.reportingManager = "Manager is inactive";
      else if (targetId && (await createsReportingCycle(targetId, input.reportingManager))) {
        fieldErrors.reportingManager = "This would create a circular reporting line";
      }
    }
  }

  if (Object.keys(fieldErrors).length) throw unprocessable(Object.values(fieldErrors)[0], fieldErrors);
}

/** Walks up the manager chain from `managerId`; a cycle exists if we reach `employeeId`. */
async function createsReportingCycle(employeeId: string, managerId: string): Promise<boolean> {
  let current: string | null = managerId;
  for (let depth = 0; current && depth < 25; depth++) {
    if (current === employeeId) return true;
    const next: { reportingManager?: Types.ObjectId | null } | null = await User.findById(current)
      .select("reportingManager")
      .lean();
    current = next?.reportingManager ? next.reportingManager.toString() : null;
  }
  return false;
}

async function generateEmployeeId(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const seq = await nextSequence("employeeId");
    const candidate = `IBZ-${String(seq).padStart(4, "0")}`;
    if (!(await User.exists({ employeeId: candidate }))) return candidate;
  }
  throw new ApiError(500, "Could not generate a unique employee ID");
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export async function listEmployees(
  actor: CurrentUser,
  query: ListQuery
): Promise<Paginated<EmployeeDTO> | EmployeeOptionDTO[]> {
  const and: Filter[] = [await employeeVisibilityFilter(actor)];

  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), "i");
    and.push({ $or: [{ name: rx }, { email: rx }, { employeeId: rx }, { phone: rx }, { designation: rx }] });
  }
  if (query.department === "none") and.push({ department: null });
  else if (query.department && /^[a-f\d]{24}$/i.test(query.department)) and.push({ department: oid(query.department) });
  if (query.role) and.push({ role: oid((await getRoleByKey(query.role)).id) });
  if (query.status) and.push({ status: query.status });

  const filter = { $and: and };

  if (query.minimal) {
    const { byId } = await getRoleMaps();
    const rows = await User.find(filter)
      .select("name email employeeId role department status")
      .sort({ name: 1 })
      .limit(500)
      .lean();
    return rows.map((u) => ({
      id: u._id.toString(),
      name: u.name,
      email: u.email,
      employeeId: u.employeeId,
      role: byId.get(u.role.toString())?.key ?? null,
      departmentId: u.department ? u.department.toString() : null,
      status: u.status as UserStatus,
    }));
  }

  const sortField = query.sort.replace(/^-/, "");
  const sortDir = query.sort.startsWith("-") ? -1 : 1;

  const [rows, total] = await Promise.all([
    User.find(filter)
      .sort({ [sortField]: sortDir, _id: 1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .populate("department", DEPT_REF_FIELDS)
      .populate("reportingManager", USER_REF_FIELDS)
      .lean(),
    User.countDocuments(filter),
  ]);

  return paginate(await Promise.all(rows.map(toEmployeeDTO)), total, query.page, query.pageSize);
}

export async function getEmployee(actor: CurrentUser, id: string): Promise<EmployeeDetailDTO> {
  const isSelf = id === actor.id;
  if (!isSelf && !hasPermission(actor.role, "employee:read")) throw forbidden();

  const filter = isSelf ? { _id: oid(id) } : { $and: [{ _id: oid(id) }, await employeeVisibilityFilter(actor)] };
  const user = await User.findOne(filter)
    .populate("department", DEPT_REF_FIELDS)
    .populate("reportingManager", USER_REF_FIELDS)
    .lean();
  if (!user) throw notFound("Employee not found");

  const self = user._id;
  const now = new Date();
  const mine = { $or: [{ owner: self }, { collaborators: self }] };

  const [reports, openTasks, inProgress, completedTasks, overdueTasks, projects, recent] = await Promise.all([
    User.find({ reportingManager: self }).select(`${USER_REF_FIELDS} role status`).sort({ name: 1 }).limit(50).lean(),
    Task.countDocuments({ ...mine, status: { $in: OPEN_TASK_STATUSES } }),
    Task.countDocuments({ ...mine, status: "IN_PROGRESS" }),
    Task.countDocuments({ ...mine, status: "COMPLETED" }),
    Task.countDocuments({ ...mine, status: { $nin: CLOSED_TASK_STATUSES }, dueDate: { $lt: now } }),
    ProjectMember.countDocuments({ user: self, isActive: true }),
    Task.find(mine)
      .sort({ updatedAt: -1 })
      .limit(8)
      .populate("owner", USER_REF_FIELDS)
      .populate("project", "name code")
      .populate("linkedTicket", "ticketNumber")
      .lean(),
  ]);

  const { byId } = await getRoleMaps();
  const manageable = await canManage(actor, user as TargetLike);

  return {
    ...(await toEmployeeDTO(user)),
    directReports: reports.map((r) => {
      const role = byId.get(r.role.toString());
      return {
        ...toUserRef(r)!,
        role: role ? { key: role.key, name: role.name } : null,
        status: r.status as UserStatus,
      };
    }),
    stats: { openTasks, inProgress, completedTasks, overdueTasks, projects },
    recentTasks: recent.map(toTaskSummary),
    can: {
      edit: manageable,
      changeRole: manageable && !isSelf && ASSIGNABLE_ROLES[actor.role].length > 0,
      changeStatus: manageable && !isSelf && hasPermission(actor.role, "employee:status"),
      resetPassword: !isSelf && hasPermission(actor.role, "employee:reset-password"),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export async function createEmployee(actor: CurrentUser, input: CreateInput): Promise<EmployeeDTO> {
  if (!hasPermission(actor.role, "employee:create")) throw forbidden();
  if (!ASSIGNABLE_ROLES[actor.role].includes(input.role)) {
    throw forbidden(`You cannot create users with the ${roleName(input.role)} role`);
  }

  await validateRefs(actor, { department: input.department ?? null, reportingManager: input.reportingManager ?? null });

  const fieldErrors: Record<string, string> = {};
  if (await User.exists({ email: input.email })) fieldErrors.email = "This email is already registered";
  if (input.employeeId && (await User.exists({ employeeId: input.employeeId }))) {
    fieldErrors.employeeId = "This employee ID is already in use";
  }
  if (Object.keys(fieldErrors).length) throw conflict(Object.values(fieldErrors)[0], fieldErrors);

  const role = await getRoleByKey(input.role);
  const employeeId = input.employeeId || (await generateEmployeeId());
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const created = await User.create({
    name: input.name,
    email: input.email,
    phone: input.phone ?? "",
    employeeId,
    designation: input.designation ?? "",
    passwordHash,
    role: oid(role.id),
    department: nullIfEmpty(input.department),
    reportingManager: nullIfEmpty(input.reportingManager),
    joiningDate: toDate(input.joiningDate),
    status: input.status,
    createdBy: oid(actor.id),
  });

  await recordAudit({
    actorId: actor.id,
    action: "employee.create",
    entityType: "User",
    entityId: created._id,
    summary: `Created employee ${created.name} (${employeeId}) as ${role.name}`,
  });

  if (created.reportingManager) {
    await notify({
      recipients: [created.reportingManager],
      actorId: actor.id,
      type: "ACCOUNT",
      title: "New team member",
      message: `${created.name} now reports to you.`,
      link: `/employees/${created._id}`,
      entityType: "User",
      entityId: created._id,
    });
  }
  if (created.department) {
    const dept = await Department.findById(created.department).select("head name").lean();
    if (dept?.head) {
      await notify({
        recipients: [dept.head],
        actorId: actor.id,
        type: "DEPARTMENT",
        title: `New employee in ${dept.name}`,
        message: `${created.name} joined ${dept.name}.`,
        link: `/employees/${created._id}`,
        entityType: "User",
        entityId: created._id,
      });
    }
  }

  const fresh = await User.findById(created._id)
    .populate("department", DEPT_REF_FIELDS)
    .populate("reportingManager", USER_REF_FIELDS)
    .lean();
  return toEmployeeDTO(fresh);
}

export async function updateEmployee(actor: CurrentUser, id: string, input: UpdateInput): Promise<EmployeeDTO> {
  const target = await User.findById(id);
  if (!target) throw notFound("Employee not found");
  if (!(await canManage(actor, target))) throw forbidden();

  const isSelf = target._id.toString() === actor.id;
  const currentRole = await getRoleById(target.role);
  const update: Record<string, unknown> = {};

  if (input.name !== undefined) update.name = input.name;
  if (input.phone !== undefined) update.phone = input.phone;
  if (input.designation !== undefined) update.designation = input.designation;
  if (input.joiningDate !== undefined) update.joiningDate = toDate(input.joiningDate);

  if (input.email !== undefined && input.email !== target.email) {
    if (await User.exists({ email: input.email, _id: { $ne: target._id } })) {
      throw conflict("This email is already registered", { email: "This email is already registered" });
    }
    update.email = input.email;
  }
  if (input.employeeId !== undefined && input.employeeId && input.employeeId !== target.employeeId) {
    if (await User.exists({ employeeId: input.employeeId, _id: { $ne: target._id } })) {
      throw conflict("This employee ID is already in use", { employeeId: "This employee ID is already in use" });
    }
    update.employeeId = input.employeeId;
  }

  // References
  const refs: { department?: string | null; reportingManager?: string | null } = {};
  if (input.department !== undefined && String(input.department ?? "") !== String(target.department ?? "")) {
    refs.department = input.department || null;
    update.department = nullIfEmpty(input.department);
  }
  if (
    input.reportingManager !== undefined &&
    String(input.reportingManager ?? "") !== String(target.reportingManager ?? "")
  ) {
    refs.reportingManager = input.reportingManager || null;
    update.reportingManager = nullIfEmpty(input.reportingManager);
  }
  if (Object.keys(refs).length) await validateRefs(actor, refs, id);

  // Role
  let newRoleKey: RoleKey | null = null;
  if (input.role && input.role !== currentRole?.key) {
    if (isSelf) throw forbidden("You cannot change your own role");
    if (!ASSIGNABLE_ROLES[actor.role].includes(input.role)) {
      throw forbidden(`You cannot assign the ${roleName(input.role)} role`);
    }
    if (currentRole?.key === "SUPER_ADMIN" && (await activeSuperAdminCount()) <= 1) {
      throw unprocessable("At least one active Super Admin is required");
    }
    newRoleKey = input.role;
    update.role = oid((await getRoleByKey(input.role)).id);
  }

  // Status
  if (input.status && input.status !== target.status) {
    await assertCanChangeStatus(actor, target, input.status);
    update.status = input.status;
    if (input.status === "INACTIVE") update.sessionVersion = (target.sessionVersion ?? 0) + 1;
  }

  if (!Object.keys(update).length) {
    const same = await User.findById(id).populate("department", DEPT_REF_FIELDS).populate("reportingManager", USER_REF_FIELDS).lean();
    return toEmployeeDTO(same);
  }

  const before = target.toObject() as Record<string, unknown>;
  await User.updateOne({ _id: target._id }, { $set: update }, { runValidators: true });

  // Keep department leadership consistent with role/department changes.
  if (update.department !== undefined) {
    const keepNew = update.department ? { _id: { $ne: update.department } } : {};
    await Department.updateMany({ teamLeaders: target._id, ...keepNew }, { $pull: { teamLeaders: target._id } });
  }
  if (newRoleKey && newRoleKey !== "TEAM_LEADER") {
    await Department.updateMany({ teamLeaders: target._id }, { $pull: { teamLeaders: target._id } });
  }
  if (newRoleKey && newRoleKey !== "DEPARTMENT_HEAD" && newRoleKey !== "SUPER_ADMIN") {
    await Department.updateMany({ head: target._id }, { $set: { head: null } });
  }

  const changes = diffFields(before, update, [
    "name", "email", "phone", "employeeId", "designation", "department", "reportingManager", "joiningDate", "status",
  ]);
  if (newRoleKey) changes.role = { from: currentRole?.key ?? null, to: newRoleKey };
  await recordAudit({
    actorId: actor.id,
    // Role changes get their own action so they're easy to find in the audit log.
    action: newRoleKey && newRoleKey !== currentRole?.key ? "employee.role_change" : "employee.update",
    entityType: "User",
    entityId: target._id,
    summary: `Updated ${target.name}: ${Object.keys(changes).join(", ") || "no changes"}`,
    changes,
  });

  if (newRoleKey) {
    await notify({
      recipients: [target._id],
      actorId: actor.id,
      type: "ACCOUNT",
      title: "Your role was updated",
      message: `You are now a ${roleName(newRoleKey)}.`,
      link: "/profile",
    });
  }
  if (update.department) {
    const dept = await Department.findById(update.department).select("name").lean();
    await notify({
      recipients: [target._id],
      actorId: actor.id,
      type: "DEPARTMENT",
      title: "Department assignment",
      message: `You have been assigned to ${dept?.name ?? "a new department"}.`,
      link: `/departments/${String(update.department)}`,
    });
  }
  if (update.reportingManager) {
    await notify({
      recipients: [update.reportingManager as string],
      actorId: actor.id,
      type: "ACCOUNT",
      title: "New direct report",
      message: `${target.name} now reports to you.`,
      link: `/employees/${target._id}`,
    });
  }

  const fresh = await User.findById(id).populate("department", DEPT_REF_FIELDS).populate("reportingManager", USER_REF_FIELDS).lean();
  return toEmployeeDTO(fresh);
}

async function assertCanChangeStatus(actor: CurrentUser, target: TargetLike, status: UserStatus) {
  if (!hasPermission(actor.role, "employee:status")) throw forbidden();
  if (target._id.toString() === actor.id) throw forbidden("You cannot change your own account status");
  if (status === "INACTIVE") {
    const role = await getRoleById(target.role);
    if (role?.key === "SUPER_ADMIN" && (await activeSuperAdminCount()) <= 1) {
      throw unprocessable("At least one active Super Admin is required");
    }
  }
}

export async function setEmployeeStatus(actor: CurrentUser, id: string, status: UserStatus): Promise<EmployeeDTO> {
  const target = await User.findById(id);
  if (!target) throw notFound("Employee not found");
  if (!(await canManage(actor, target))) throw forbidden();
  if (target.status === status) {
    throw badRequest(`Employee is already ${status === "ACTIVE" ? "active" : "inactive"}`);
  }
  await assertCanChangeStatus(actor, target, status);

  const update: Record<string, unknown> = { status };
  // Deactivation revokes all existing sessions immediately.
  if (status === "INACTIVE") update.sessionVersion = (target.sessionVersion ?? 0) + 1;
  else update.failedLoginAttempts = 0;
  await User.updateOne({ _id: target._id }, { $set: update });

  await recordAudit({
    actorId: actor.id,
    action: status === "ACTIVE" ? "employee.activate" : "employee.deactivate",
    entityType: "User",
    entityId: target._id,
    summary: `${status === "ACTIVE" ? "Activated" : "Deactivated"} ${target.name}`,
    changes: { status: { from: target.status, to: status } },
  });

  const fresh = await User.findById(id).populate("department", DEPT_REF_FIELDS).populate("reportingManager", USER_REF_FIELDS).lean();
  return toEmployeeDTO(fresh);
}

export async function adminResetPassword(actor: CurrentUser, id: string, password: string): Promise<void> {
  if (!hasPermission(actor.role, "employee:reset-password")) throw forbidden();
  if (id === actor.id) throw forbidden("Use your profile page to change your own password");
  const target = await User.findById(id).select("name sessionVersion");
  if (!target) throw notFound("Employee not found");

  await User.updateOne(
    { _id: target._id },
    {
      $set: {
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        sessionVersion: (target.sessionVersion ?? 0) + 1,
        failedLoginAttempts: 0,
        lockUntil: null,
        passwordResetTokenHash: null,
        passwordResetExpires: null,
      },
    }
  );
  await recordAudit({
    actorId: actor.id,
    action: "employee.reset_password",
    entityType: "User",
    entityId: target._id,
    summary: `Reset password for ${target.name}`,
  });
  await notify({
    recipients: [target._id],
    actorId: actor.id,
    type: "ACCOUNT",
    title: "Password reset by administrator",
    message: "Your password was reset. Sign in with the new password you received.",
    link: "/profile",
  });
}


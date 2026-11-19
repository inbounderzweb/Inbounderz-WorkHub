import "server-only";
import type { CurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/permissions";
import type { ClientViewLevel } from "@/lib/constants";
import { Project, Task } from "@/models";
import { accessContext, projectVisibilityFilter } from "./access";
import { oid, type Filter } from "./scope";

/**
 * Who may see and change which client. Two separate questions:
 *   1. Row scope  - which clients exist for this user (`clientVisibilityFilter`).
 *   2. Field scope - how much of each visible client they get (`ClientRights.level`).
 * Every client API goes through both; the UI only mirrors the result.
 *
 *   Admin             all clients, full detail, everything.
 *   Sales Executive   clients they own: full detail, edit all (except owner reassignment / archive).
 *   Project Manager   every client: full detail, edit non-financial data.
 *   Dept Head / Lead  clients of projects visible to them: identity + contact person, read-only.
 *   Everyone else     clients of projects they work on: name, category, website, read-only.
 */

export type ClientRights = {
  level: ClientViewLevel;
  /** May edit ordinary fields (name, contacts, addresses, notes). */
  update: boolean;
  /** May edit GST, billing address and currency. Narrower than `update`. */
  editRestricted: boolean;
  changeOwner: boolean;
  changeStatus: boolean;
  archive: boolean;
  /** Admin powers: duplicate override, review resolution. */
  manage: boolean;
};

const NO_RIGHTS: ClientRights = { level: "MINIMAL", update: false, editRestricted: false, changeOwner: false, changeStatus: false, archive: false, manage: false };

const isAdmin = (u: CurrentUser) => u.role === "SUPER_ADMIN";

/** Clients linked to projects the user can see or has been given tasks on. */
export async function associatedClientIds(user: CurrentUser) {
  const ctx = await accessContext(user);
  const self = oid(user.id);
  const taskProjects = await Task.find({ $or: [{ owner: self }, { collaborators: self }], project: { $ne: null } })
    .distinct("project");
  const visibility = projectVisibilityFilter(ctx);
  const or: Filter[] = [];
  if (Object.keys(visibility).length) or.push(visibility);
  if (taskProjects.length) or.push({ _id: { $in: taskProjects } });
  if (!or.length) return [];
  return Project.find({ clientRef: { $ne: null }, $or: or }).distinct("clientRef");
}

/** Mongo filter for the clients this user may know exist. */
export async function clientVisibilityFilter(user: CurrentUser): Promise<Filter> {
  if (isAdmin(user)) return {};
  // Project Managers plan every handover and project, so they see every client, including ones with no project yet.
  if (user.role === "PROJECT_MANAGER") return {};
  if (user.role === "SALES_EXECUTIVE") return { salesOwner: oid(user.id) };
  // Anyone allowed to create clients (e.g. a Department Head the Super Admin granted it to) must always see the clients they own.
  return { $or: [{ _id: { $in: await associatedClientIds(user) } }, { salesOwner: oid(user.id) }] };
}

/** Field/permission level for a user on a client they can see. Call only for visible clients. */
export function clientRights(user: CurrentUser, client: { salesOwner?: unknown }): ClientRights {
  const mayUpdate = hasPermission(user.role, "client:update");
  const manage = hasPermission(user.role, "client:manage");
  if (isAdmin(user)) {
    return { level: "FULL", update: true, editRestricted: true, changeOwner: true, changeStatus: true, archive: true, manage };
  }
  if (user.role === "SALES_EXECUTIVE") {
    const owns = String((client.salesOwner as { _id?: unknown } | null)?._id ?? client.salesOwner ?? "") === user.id;
    if (!owns) return NO_RIGHTS;
    return { level: "FULL", update: mayUpdate, editRestricted: mayUpdate, changeOwner: false, changeStatus: mayUpdate, archive: false, manage };
  }
  if (user.role === "PROJECT_MANAGER") {
    return { level: "FULL", update: mayUpdate, editRestricted: false, changeOwner: false, changeStatus: false, archive: false, manage };
  }
  // Owner of the client (they created it): same rights as an owning Sales Executive, whatever their role.
  const owns = String((client.salesOwner as { _id?: unknown } | null)?._id ?? client.salesOwner ?? "") === user.id;
  if (owns && hasPermission(user.role, "client:create")) {
    return { level: "FULL", update: mayUpdate, editRestricted: mayUpdate, changeOwner: false, changeStatus: mayUpdate, archive: false, manage };
  }
  if (user.role === "DEPARTMENT_HEAD" || user.role === "TEAM_LEADER") return { ...NO_RIGHTS, level: "LIMITED" };
  return NO_RIGHTS;
}

/** The viewing level a role gets before looking at a specific client (used for list columns and search). */
export function roleViewLevel(user: CurrentUser): ClientViewLevel {
  if (isAdmin(user) || user.role === "SALES_EXECUTIVE" || user.role === "PROJECT_MANAGER") return "FULL";
  if (user.role === "DEPARTMENT_HEAD" || user.role === "TEAM_LEADER") return "LIMITED";
  return "MINIMAL";
}

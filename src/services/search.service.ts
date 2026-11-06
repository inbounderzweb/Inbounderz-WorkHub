import "server-only";
import type { CurrentUser } from "@/lib/auth/current-user";
import { escapeRegex } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import type { ProjectStatus } from "@/lib/constants";
import { Department, Project, User } from "@/models";
import type { SearchResultDTO } from "@/types/dto";
import { employeeVisibilityFilter, visibleDepartmentIds, visibleProjectIds } from "./scope";

/** Global search across entities the user is allowed to see. */
export async function globalSearch(user: CurrentUser, q: string): Promise<SearchResultDTO> {
  const empty: SearchResultDTO = { employees: [], departments: [], projects: [] };
  if (q.trim().length < 2) return empty;
  const rx = new RegExp(escapeRegex(q.trim()), "i");

  const [employees, departments, projects] = await Promise.all([
    (async () => {
      if (!hasPermission(user.role, "employee:read")) return [];
      const scope = await employeeVisibilityFilter(user);
      const rows = await User.find({ $and: [scope, { $or: [{ name: rx }, { email: rx }, { employeeId: rx }] }] })
        .select("name email employeeId department")
        .populate("department", "name")
        .limit(6)
        .lean();
      return rows.map((u) => ({
        id: u._id.toString(),
        name: u.name,
        email: u.email,
        employeeId: u.employeeId,
        department: (u.department as unknown as { name?: string } | null)?.name ?? null,
      }));
    })(),
    (async () => {
      if (!hasPermission(user.role, "department:read")) return [];
      const visible = await visibleDepartmentIds(user);
      const rows = await Department.find({
        ...(visible ? { _id: { $in: visible } } : {}),
        $or: [{ name: rx }, { code: rx }],
      })
        .select("name code color")
        .limit(5)
        .lean();
      return rows.map((d) => ({ id: d._id.toString(), name: d.name, code: d.code, color: d.color ?? "#16a34a" }));
    })(),
    (async () => {
      if (!hasPermission(user.role, "project:read")) return [];
      const visible = await visibleProjectIds(user);
      const rows = await Project.find({
        ...(visible ? { _id: { $in: visible } } : {}),
        $or: [{ name: rx }, { code: rx }, { client: rx }],
      })
        .select("name code status")
        .limit(5)
        .lean();
      return rows.map((p) => ({ id: p._id.toString(), name: p.name, code: p.code, status: p.status as ProjectStatus }));
    })(),
  ]);

  return { employees, departments, projects };
}

import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { getRoleById } from "@/lib/roles";
import { hasPermission, ROLE_PERMISSIONS, type Permission } from "@/lib/permissions";
import type { RoleKey } from "@/lib/constants";
import { User } from "@/models";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  employeeId: string;
  designation: string;
  avatarUrl: string;
  role: RoleKey;
  roleName: string;
  roleLevel: number;
  permissions: Permission[];
  departmentId: string | null;
};

/**
 * Resolves the signed-in user from the database on every request (memoised per
 * request with React `cache`). The JWT only carries the user id: status, role and
 * department always come from MongoDB, so deactivations and role changes take
 * effect immediately, and a password reset (sessionVersion bump) revokes sessions.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  await connectDB();
  const user = await User.findById(userId)
    .select("name email employeeId designation avatarUrl role department status sessionVersion")
    .lean();
  if (!user || user.status !== "ACTIVE") return null;
  if ((user.sessionVersion ?? 0) !== (session.user.sessionVersion ?? 0)) return null;

  const role = await getRoleById(user.role);
  if (!role) return null;

  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    employeeId: user.employeeId,
    designation: user.designation ?? "",
    avatarUrl: user.avatarUrl ?? "",
    role: role.key,
    roleName: role.name,
    roleLevel: role.level,
    permissions: ROLE_PERMISSIONS[role.key],
    departmentId: user.department ? user.department.toString() : null,
  };
});

/** For Server Components / pages: redirect to login if not signed in. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?reason=session");
  return user;
}

/** For pages: render the 403 screen if the permission is missing. */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!hasPermission(user.role, permission)) redirect("/forbidden");
  return user;
}

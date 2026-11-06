"use client";

import { createContext, useContext } from "react";
import type { RoleKey } from "@/lib/constants";
import { hasPermission, type Permission } from "@/lib/permissions";

/** The subset of the server-side CurrentUser that is safe to send to the browser. */
export type ClientUser = {
  id: string;
  name: string;
  email: string;
  employeeId: string;
  designation: string;
  avatarUrl: string;
  role: RoleKey;
  roleName: string;
  departmentId: string | null;
};

const UserContext = createContext<ClientUser | null>(null);

export function UserProvider({ user, children }: { user: ClientUser; children: React.ReactNode }) {
  return <UserContext value={user}>{children}</UserContext>;
}

export function useCurrentUser(): ClientUser {
  const user = useContext(UserContext);
  if (!user) throw new Error("useCurrentUser must be used inside <UserProvider>");
  return user;
}

/** UI-only permission check. The server always re-validates. */
export function useCan(permission: Permission): boolean {
  return hasPermission(useCurrentUser().role, permission);
}

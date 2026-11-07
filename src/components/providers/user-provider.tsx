"use client";

import { createContext, useContext } from "react";
import type { RoleKey } from "@/lib/constants";
import type { Permission } from "@/lib/permissions";
import type { PublicSettings } from "@/lib/settings-types";

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
  /** Effective permissions (role matrix + configured overrides), computed on the server. */
  permissions: Permission[];
};

const UserContext = createContext<ClientUser | null>(null);
const SettingsContext = createContext<PublicSettings | null>(null);

export function UserProvider({ user, settings, children }: { user: ClientUser; settings: PublicSettings; children: React.ReactNode }) {
  return (
    <UserContext value={user}>
      <SettingsContext value={settings}>{children}</SettingsContext>
    </UserContext>
  );
}

/** Company profile, status/priority labels and policies configured by the Super Admin. */
export function useSettings(): PublicSettings | null {
  return useContext(SettingsContext);
}

export function useCurrentUser(): ClientUser {
  const user = useContext(UserContext);
  if (!user) throw new Error("useCurrentUser must be used inside <UserProvider>");
  return user;
}

/** UI-only permission check. The server always re-validates. */
export function useCan(permission: Permission): boolean {
  return useCurrentUser().permissions.includes(permission);
}

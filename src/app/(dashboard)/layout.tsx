import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/current-user";
import { getSystemSettings, toPublicSettings } from "@/lib/settings";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const settings = toPublicSettings(await getSystemSettings());
  return (
    <AppShell
      user={{
        id: user.id,
        name: user.name,
        email: user.email,
        employeeId: user.employeeId,
        designation: user.designation,
        avatarUrl: user.avatarUrl,
        role: user.role,
        roleName: user.roleName,
        departmentId: user.departmentId,
        permissions: user.permissions,
      }}
      settings={settings}
    >
      {children}
    </AppShell>
  );
}

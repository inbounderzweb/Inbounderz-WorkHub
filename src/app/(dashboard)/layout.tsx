import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/current-user";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
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
      }}
    >
      {children}
    </AppShell>
  );
}

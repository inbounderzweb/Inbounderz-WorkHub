import type { Metadata } from "next";
import { format } from "date-fns";
import { requireUser } from "@/lib/auth/current-user";
import { connectDB } from "@/lib/db";
import { getDashboard } from "@/services/dashboard.service";
import { PageHeader } from "@/components/shared/page-header";
import {
  AdminDashboardView,
  EmployeeDashboardView,
  ManagerDashboardView,
  TeamDashboardView,
} from "@/components/dashboard/dashboards";

export const metadata: Metadata = { title: "Dashboard" };

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const user = await requireUser();
  await connectDB();
  const data = await getDashboard(user);
  const now = new Date();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting(now.getHours())}, ${user.name.split(" ")[0]}`}
        description={`${format(now, "EEEE, d MMMM yyyy")} · ${user.roleName} overview`}
      />
      {data.kind === "admin" ? <AdminDashboardView data={data} /> : null}
      {data.kind === "manager" ? <ManagerDashboardView data={data} /> : null}
      {data.kind === "team" ? <TeamDashboardView data={data} /> : null}
      {data.kind === "employee" ? <EmployeeDashboardView data={data} /> : null}
    </div>
  );
}

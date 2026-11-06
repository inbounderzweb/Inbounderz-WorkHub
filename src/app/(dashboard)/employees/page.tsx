import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { EmployeesView } from "@/components/employees/employees-view";

export const metadata: Metadata = { title: "Employees" };

export default async function EmployeesPage() {
  await requirePermission("employee:read");
  return <EmployeesView />;
}

import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { DepartmentsView } from "@/components/departments/departments-view";

export const metadata: Metadata = { title: "Departments" };

export default async function DepartmentsPage() {
  await requirePermission("department:read");
  return <DepartmentsView />;
}

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/permissions";
import { EmployeeProfile } from "@/components/employees/employee-profile";

export const metadata: Metadata = { title: "Employee profile" };

export default async function EmployeeDetailPage({ params }: PageProps<"/employees/[id]">) {
  const { id } = await params;
  if (!/^[a-f\d]{24}$/i.test(id)) notFound();
  const user = await requireUser();
  if (id === user.id) redirect("/profile");
  if (!hasPermission(user.role, "employee:read")) redirect("/forbidden");
  return <EmployeeProfile employeeId={id} />;
}

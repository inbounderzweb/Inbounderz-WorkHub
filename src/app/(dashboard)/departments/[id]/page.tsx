import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current-user";
import { DepartmentDetail } from "@/components/departments/department-detail";

export const metadata: Metadata = { title: "Department" };

export default async function DepartmentDetailPage({ params }: PageProps<"/departments/[id]">) {
  const { id } = await params;
  if (!/^[a-f\d]{24}$/i.test(id)) notFound();
  await requirePermission("department:read");
  return <DepartmentDetail id={id} />;
}

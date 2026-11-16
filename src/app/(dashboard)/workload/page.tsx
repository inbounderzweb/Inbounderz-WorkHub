import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { WorkloadView } from "@/components/workload/workload-view";

export const metadata: Metadata = { title: "Workload" };

export default async function WorkloadPage() {
  await requirePermission("ticket:manage");
  return <WorkloadView />;
}

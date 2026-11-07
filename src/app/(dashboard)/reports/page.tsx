import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/current-user";
import { ReportsView } from "@/components/reports/reports-view";

export const metadata: Metadata = { title: "Reports" };

// Every signed-in user has personal reports; wider sections depend on report permissions (checked in the API).
export default async function ReportsPage() {
  await requireUser();
  return <ReportsView />;
}

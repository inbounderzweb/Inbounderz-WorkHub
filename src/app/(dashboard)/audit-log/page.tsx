import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/shared/page-header";
import { AuditPanel } from "@/components/settings/audit-panel";

export const metadata: Metadata = { title: "Audit Log" };

export default async function AuditLogPage() {
  await requirePermission("audit:read");
  return (
    <div className="space-y-5">
      <PageHeader title="Audit Log" description="Who did what, and when: user, role, project, task, ticket, report and settings changes." />
      <AuditPanel />
    </div>
  );
}

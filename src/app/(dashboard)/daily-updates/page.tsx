import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/current-user";
import { TableSkeleton } from "@/components/shared/skeletons";
import { DailyUpdatesView } from "@/components/daily-updates/daily-updates-view";

export const metadata: Metadata = { title: "Daily Updates" };

export default async function DailyUpdatesPage() {
  await requirePermission("daily-update:submit");
  return (
    <Suspense fallback={<TableSkeleton rows={6} cols={5} />}>
      <DailyUpdatesView />
    </Suspense>
  );
}

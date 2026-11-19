import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { DuplicateReviewsView } from "@/components/clients/duplicate-reviews-view";

export const metadata: Metadata = { title: "Duplicate reviews" };

export default async function DuplicateReviewsPage() {
  await requirePermission("client:manage");
  return <DuplicateReviewsView />;
}

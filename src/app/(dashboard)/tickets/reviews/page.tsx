import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { ReviewQueue } from "@/components/tickets/review-queue";

export const metadata: Metadata = { title: "Review queue" };

export default async function ReviewQueuePage() {
  await requirePermission("ticket:create");
  return <ReviewQueue />;
}

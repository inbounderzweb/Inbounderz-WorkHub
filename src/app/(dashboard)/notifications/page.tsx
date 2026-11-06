import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/current-user";
import { NotificationsView } from "@/components/notifications/notifications-view";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requireUser();
  return <NotificationsView />;
}

import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { SettingsView } from "@/components/settings/settings-view";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePermission("settings:manage");
  return <SettingsView />;
}

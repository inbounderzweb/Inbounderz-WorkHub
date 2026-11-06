import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/current-user";
import { ProfileView } from "@/components/employees/profile-view";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  await requireUser();
  return <ProfileView />;
}

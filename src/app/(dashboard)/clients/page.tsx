import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { ClientsView } from "@/components/clients/clients-view";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  await requirePermission("client:read");
  return <ClientsView />;
}

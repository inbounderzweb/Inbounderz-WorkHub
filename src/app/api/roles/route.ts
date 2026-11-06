import { withAuth } from "@/lib/api";
import { listRolesOverview } from "@/services/settings.service";

export const GET = withAuth(async () => listRolesOverview(), { permission: "settings:manage" });

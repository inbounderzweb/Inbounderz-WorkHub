import { withAuth } from "@/lib/api";
import { dbHealth } from "@/lib/db-health";

/** Admin-only. Reports topology and transaction support so deployments can be verified without credentials. */
export const GET = withAuth(async () => dbHealth(), { permission: "settings:manage" });

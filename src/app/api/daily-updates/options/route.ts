import { withAuth } from "@/lib/api";
import { reportableWork } from "@/services/daily-update.service";

/** Projects (and the user's open tasks in them) that a report can be filed against. */
export const GET = withAuth(async (_req, _ctx, user) => reportableWork(user), { permission: "daily-update:submit" });

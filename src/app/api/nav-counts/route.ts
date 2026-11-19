import { withAuth } from "@/lib/api";
import { navCounts } from "@/services/nav-counts.service";

/** Sidebar badge counts: how many items are waiting on the signed-in user, per nav item. */
export const GET = withAuth(async (_req, _ctx, user) => navCounts(user));

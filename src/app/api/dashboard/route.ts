import { withAuth } from "@/lib/api";
import { getDashboard } from "@/services/dashboard.service";

export const GET = withAuth(async (_req, _ctx, user) => getDashboard(user));

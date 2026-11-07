import { parseQuery, withAuth } from "@/lib/api";
import { dailySummaryQuerySchema } from "@/lib/validations/daily-update";
import { dailySummary } from "@/services/daily-update.service";

export const GET = withAuth(async (req, _ctx, user) => dailySummary(user, parseQuery(req, dailySummaryQuerySchema)));

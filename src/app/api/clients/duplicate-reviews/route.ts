import { parseQuery, withAuth } from "@/lib/api";
import { duplicateReviewQuerySchema } from "@/lib/validations/client";
import { listDuplicateReviews } from "@/services/client.service";

export const GET = withAuth(async (req, _ctx, user) => listDuplicateReviews(user, parseQuery(req, duplicateReviewQuerySchema)), { permission: "client:manage" });

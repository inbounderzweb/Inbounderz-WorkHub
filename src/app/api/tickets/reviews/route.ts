import { parseQuery, withAuth } from "@/lib/api";
import { reviewQueueQuerySchema } from "@/lib/validations/ticket";
import { listReviews } from "@/services/ticket.service";

/** Review queue: reviews routed to the caller, plus the reviews a Project Manager triages. */
export const GET = withAuth(async (req, _ctx, user) => listReviews(user, parseQuery(req, reviewQueueQuerySchema)), { permission: "ticket:create" });

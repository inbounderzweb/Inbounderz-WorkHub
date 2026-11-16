import { parseQuery, withAuth } from "@/lib/api";
import { workloadQuerySchema } from "@/lib/validations/workload";
import { workloadOverview } from "@/services/workload.service";

/** Cards, distribution, department comparison and trend. Scope is enforced in the service. */
export const GET = withAuth(async (req, _ctx, user) => workloadOverview(user, parseQuery(req, workloadQuerySchema)), { permission: "ticket:manage" });

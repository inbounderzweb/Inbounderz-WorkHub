import { parseQuery, withAuth } from "@/lib/api";
import { workloadEmployeesQuerySchema } from "@/lib/validations/workload";
import { workloadEmployees } from "@/services/workload.service";

export const GET = withAuth(async (req, _ctx, user) => workloadEmployees(user, parseQuery(req, workloadEmployeesQuerySchema)), { permission: "ticket:manage" });

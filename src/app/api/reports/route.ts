import { z } from "zod";
import { parseQuery, withAuth } from "@/lib/api";
import { getReports } from "@/services/report.service";

const schema = z.object({
  months: z.coerce.number().int().min(3).max(12).optional().default(6),
  department: z.string().optional().default(""),
});

/** Role-shaped analytics computed from MongoDB (sections depend on report permissions). */
export const GET = withAuth(async (req, _ctx, user) => getReports(user, parseQuery(req, schema)));

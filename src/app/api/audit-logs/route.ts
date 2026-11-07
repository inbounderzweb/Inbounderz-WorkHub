import { z } from "zod";
import { parseQuery, withAuth } from "@/lib/api";
import { listAuditLogs } from "@/services/settings.service";

const schema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional().default(""),
  from: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional().default(""),
  to: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional().default(""),
  entityType: z.enum(["", "User", "Department", "Project", "Task", "Ticket", "TicketCategory", "DailyUpdate", "Settings", "Report"]).optional().default(""),
});

export const GET = withAuth(async (req) => listAuditLogs(parseQuery(req, schema)), { permission: "audit:read" });

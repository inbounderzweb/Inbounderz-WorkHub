import { z } from "zod";
import { parseQuery, withAuth } from "@/lib/api";
import { CALENDAR_TYPES, calendarEvents, type CalendarType } from "@/services/calendar.service";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-MM-dd");
const schema = z.object({
  from: day,
  to: day,
  types: z
    .string()
    .optional()
    .default(CALENDAR_TYPES.join(","))
    .transform((v) => v.split(",").filter(Boolean))
    .pipe(z.array(z.enum(CALENDAR_TYPES))),
  mine: z.enum(["", "0", "1"]).optional().default("").transform((v) => v === "1"),
});

/** Deadlines the user may see in a date range (permission-scoped in the service). */
export const GET = withAuth(async (req, _ctx, user) => {
  const q = parseQuery(req, schema);
  return calendarEvents(user, { ...q, types: q.types as CalendarType[] });
});

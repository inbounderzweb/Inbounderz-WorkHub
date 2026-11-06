import { format } from "date-fns";

/**
 * Date-only fields (start/due/deadline/joining dates) are stored as UTC instants
 * on their calendar day (start dates at 00:00Z, due dates at 23:59:59Z). Always
 * read them back by that calendar day, never by the viewer's local clock —
 * otherwise "31 Dec" shows as "1 Jan" east of UTC, or "30 Dec" west of it.
 */
export function day(iso: string | Date): Date {
  const s = typeof iso === "string" ? iso : iso.toISOString();
  return new Date(`${s.slice(0, 10)}T00:00:00`);
}

export function formatDay(iso: string | null | undefined, pattern = "d MMM yyyy"): string {
  return iso ? format(day(iso), pattern) : "—";
}

/** UTC range covering the calendar days [from, from + days) for date-only queries. */
export function utcDayRange(from: Date, days = 1): { $gte: Date; $lte: Date } {
  const start = format(from, "yyyy-MM-dd");
  const endDate = new Date(from);
  endDate.setDate(endDate.getDate() + days - 1);
  return { $gte: new Date(`${start}T00:00:00.000Z`), $lte: new Date(`${format(endDate, "yyyy-MM-dd")}T23:59:59.999Z`) };
}

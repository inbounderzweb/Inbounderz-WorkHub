import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/current-user";
import { CalendarView } from "@/components/calendar/calendar-view";

export const metadata: Metadata = { title: "Calendar" };

// Every event is filtered by the user's access in /api/calendar.
export default async function CalendarPage() {
  await requireUser();
  return <CalendarView />;
}

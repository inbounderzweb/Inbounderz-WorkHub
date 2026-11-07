import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { withPublic } from "@/lib/api";
import { runReminderSweep } from "@/services/reminder.service";

/**
 * Optional scheduler hook (e.g. Vercel Cron every 15 min). Requires
 * `Authorization: Bearer <CRON_SECRET>`. Without CRON_SECRET the endpoint is off;
 * reminders still run automatically while people use the app.
 */
export const GET = withPublic(async (req: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return { ok: true, ...(await runReminderSweep()) };
});

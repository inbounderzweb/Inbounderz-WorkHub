import { parseBody, parseQuery, withAuth } from "@/lib/api";
import { createDailyUpdateSchema, dailyUpdateListQuerySchema } from "@/lib/validations/daily-update";
import { createDailyUpdate, listDailyUpdates } from "@/services/daily-update.service";

// scope=mine → own reports; scope=team → reports the user reviews or oversees (enforced in the service).
export const GET = withAuth(async (req, _ctx, user) => listDailyUpdates(user, parseQuery(req, dailyUpdateListQuerySchema)));

export const POST = withAuth(
  async (req, _ctx, user) => Response.json(await createDailyUpdate(user, await parseBody(req, createDailyUpdateSchema)), { status: 201 }),
  { permission: "daily-update:submit" }
);

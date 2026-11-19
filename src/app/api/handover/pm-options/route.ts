import { withAuth } from "@/lib/api";
import { listPmOptions } from "@/services/handover.service";

/** Active Project Managers for the client form and handover; the service decides who may ask. */
export const GET = withAuth(async (_req, _ctx, user) => listPmOptions(user));

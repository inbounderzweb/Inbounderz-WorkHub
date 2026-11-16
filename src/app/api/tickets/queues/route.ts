import { withAuth } from "@/lib/api";
import { teamWorkload } from "@/services/ticket.service";

/** Team workload overview for the Employee queues tab. Project Managers and Super Admins only. */
export const GET = withAuth(async (_req, _ctx, user) => teamWorkload(user), { permission: "ticket:manage" });

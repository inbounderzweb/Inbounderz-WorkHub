import { withAuth } from "@/lib/api";
import { ticketTargetDepartments } from "@/services/ticket.service";

/** Active departments a ticket can be sent to (name/code/colour only), for anyone who may raise tickets. */
export const GET = withAuth(async () => ticketTargetDepartments(), { permission: "ticket:create" });

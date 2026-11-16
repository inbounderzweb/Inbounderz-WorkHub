import { withAuth } from "@/lib/api";
import { ticketManagerOptions } from "@/services/ticket.service";

export const GET = withAuth(async () => ticketManagerOptions(), { permission: "ticket:create" });

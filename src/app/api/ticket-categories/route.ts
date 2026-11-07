import { z } from "zod";
import { parseBody, parseQuery, withAuth } from "@/lib/api";
import { ticketCategorySchema } from "@/lib/validations/ticket";
import { createTicketCategory, listTicketCategories } from "@/services/ticket-category.service";

const query = z.object({ all: z.enum(["", "0", "1"]).optional().default("") });

// Active categories for everyone; ?all=1 (Super Admin) also returns inactive ones with usage counts.
export const GET = withAuth(async (req, _ctx, user) => listTicketCategories(user, parseQuery(req, query).all === "1"));

export const POST = withAuth(
  async (req, _ctx, user) => Response.json(await createTicketCategory(user, await parseBody(req, ticketCategorySchema)), { status: 201 }),
  { permission: "settings:manage" }
);

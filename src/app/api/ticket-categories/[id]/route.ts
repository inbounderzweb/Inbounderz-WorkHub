import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { updateTicketCategorySchema } from "@/lib/validations/ticket";
import { updateTicketCategory } from "@/services/ticket-category.service";

// Categories are deactivated, never deleted, so existing tickets keep their history.
export const PATCH = withAuth<RouteContext<"/api/ticket-categories/[id]">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return updateTicketCategory(user, id, await parseBody(req, updateTicketCategorySchema));
}, { permission: "settings:manage" });

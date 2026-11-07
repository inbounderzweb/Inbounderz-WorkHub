import { z } from "zod";
import { assertObjectId, parseQuery, withAuth } from "@/lib/api";
import { objectId } from "@/lib/validations/common";
import { eligibleAssignees } from "@/services/ticket.service";

const schema = z.object({ department: objectId });

/** Active employees of the chosen department who may take this ticket. */
export const GET = withAuth<RouteContext<"/api/tickets/[id]/assignees">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return eligibleAssignees(user, id, parseQuery(req, schema).department);
}, { permission: "ticket:manage" });

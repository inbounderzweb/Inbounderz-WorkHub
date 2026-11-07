import { assertObjectId, readUpload, withAuth } from "@/lib/api";
import { uploadAttachment } from "@/services/attachment.service";

/** Reference files (requester, assignee, managers). */
export const POST = withAuth<RouteContext<"/api/tickets/[id]/attachments">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return Response.json(await uploadAttachment(user, "Ticket", id, await readUpload(req), "FILE"), { status: 201 });
});

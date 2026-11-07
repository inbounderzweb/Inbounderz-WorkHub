import { assertObjectId, readUpload, withAuth } from "@/lib/api";
import { uploadAttachment } from "@/services/attachment.service";

/** Completed work, uploaded by the assignee and submitted with "Submit as resolved". */
export const POST = withAuth<RouteContext<"/api/tickets/[id]/deliverables">>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return Response.json(await uploadAttachment(user, "Ticket", id, await readUpload(req), "DELIVERABLE"), { status: 201 });
});

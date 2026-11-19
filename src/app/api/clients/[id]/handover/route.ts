import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { createHandoverSchema } from "@/lib/validations/handover";
import { createHandover } from "@/services/handover.service";

type Ctx = RouteContext<"/api/clients/[id]/handover">;

/** Creates a project from the client's approved requirements and (optionally) submits it to a Project Manager. */
export const POST = withAuth<Ctx>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return Response.json(await createHandover(user, id, await parseBody(req, createHandoverSchema)), { status: 201 });
}, { permission: "project:handover" });

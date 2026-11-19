import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { clientContactSchema } from "@/lib/validations/client";
import { addContact, listContacts } from "@/services/client.service";

type Ctx = RouteContext<"/api/clients/[id]/contacts">;

export const GET = withAuth<Ctx>(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return listContacts(user, id);
}, { permission: "client:read" });

export const POST = withAuth<Ctx>(async (req, ctx, user) => {
  const { id } = await ctx.params;
  assertObjectId(id);
  return Response.json(await addContact(user, id, await parseBody(req, clientContactSchema)), { status: 201 });
}, { permission: "client:update" });

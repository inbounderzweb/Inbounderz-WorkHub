import { assertObjectId, parseBody, withAuth } from "@/lib/api";
import { updateClientContactSchema } from "@/lib/validations/client";
import { removeContact, updateContact } from "@/services/client.service";

type Ctx = RouteContext<"/api/clients/[id]/contacts/[contactId]">;

export const PATCH = withAuth<Ctx>(async (req, ctx, user) => {
  const { id, contactId } = await ctx.params;
  assertObjectId(id);
  assertObjectId(contactId, "contact id");
  return updateContact(user, id, contactId, await parseBody(req, updateClientContactSchema));
}, { permission: "client:update" });

export const DELETE = withAuth<Ctx>(async (_req, ctx, user) => {
  const { id, contactId } = await ctx.params;
  assertObjectId(id);
  assertObjectId(contactId, "contact id");
  await removeContact(user, id, contactId);
}, { permission: "client:update" });

import "server-only";
import type { CurrentUser } from "@/lib/auth/current-user";
import { conflict, forbidden, notFound } from "@/lib/api";
import { Client } from "@/models";
import { clientRights, clientVisibilityFilter, type ClientRights } from "./client-access";
import { USER_REF_FIELDS } from "./mappers";
import { oid } from "./scope";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Client loading and access helpers shared by the client and requirement services (a leaf module). */

export const POPULATE_PEOPLE = [
  { path: "salesOwner", select: USER_REF_FIELDS },
  { path: "projectManager", select: USER_REF_FIELDS },
  { path: "createdBy", select: USER_REF_FIELDS },
  { path: "updatedBy", select: USER_REF_FIELDS },
];

/** Loads a client only if the user may see it; otherwise 404 so existence is not revealed. */
export async function loadVisible(user: CurrentUser, id: string) {
  const visibility = await clientVisibilityFilter(user);
  const client = await Client.findOne({ $and: [{ _id: oid(id) }, visibility] }).populate(POPULATE_PEOPLE).lean();
  if (!client) throw notFound("Client not found");
  return { client: client as any, rights: clientRights(user, client) };
}

export function requireFull(rights: ClientRights, what: string) {
  if (rights.level !== "FULL") throw forbidden(`You do not have access to ${what}`);
}

export async function touch(clientId: any, userId: string, session: any, expectedUpdatedAt?: string) {
  const result = await Client.updateOne({ _id: clientId, status: { $ne: "ARCHIVED" }, ...(expectedUpdatedAt ? { updatedAt: new Date(expectedUpdatedAt) } : {}) }, { $set: { updatedBy: oid(userId) } }, { session });
  if (!result.matchedCount) throw conflict("This client changed or was archived. Reload before saving.");
}

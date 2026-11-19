import { parseBody, parseQuery, withAuth } from "@/lib/api";
import { clientListQuerySchema, createClientSchema } from "@/lib/validations/client";
import { createClient, listClients } from "@/services/client.service";

export const GET = withAuth(async (req, _ctx, user) => listClients(user, parseQuery(req, clientListQuerySchema)), { permission: "client:read" });

export const POST = withAuth(
  async (req, _ctx, user) => Response.json(await createClient(user, await parseBody(req, createClientSchema)), { status: 201 }),
  { permission: "client:create" }
);

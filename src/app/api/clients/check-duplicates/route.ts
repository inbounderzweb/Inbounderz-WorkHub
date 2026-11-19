import { parseBody, withAuth } from "@/lib/api";
import { checkDuplicatesSchema } from "@/lib/validations/client";
import { checkDuplicates } from "@/services/client.service";

// Used while typing in the client form. Same permission gate as create/update, checked again in the service.
export const POST = withAuth(async (req, _ctx, user) => checkDuplicates(user, await parseBody(req, checkDuplicatesSchema)), { permission: "client:read" });

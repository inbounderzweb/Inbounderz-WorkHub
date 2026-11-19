import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import { ROLE_KEYS } from "@/lib/constants";
import { setRolePermission } from "@/services/settings.service";

const schema = z.object({
  role: z.enum(ROLE_KEYS),
  permission: z.string().refine((p): p is Permission => p in PERMISSIONS, "Unknown permission"),
  allowed: z.boolean(),
});

/** Grant or revoke one permission for a role. Super Admin only (settings:manage is held by nobody else). */
export const PATCH = withAuth(
  async (req, _ctx, user) => {
    const { role, permission, allowed } = await parseBody(req, schema);
    await setRolePermission(user, role, permission as Permission, allowed);
    return { ok: true };
  },
  { permission: "settings:manage" }
);

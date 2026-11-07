import { parseBody, withAuth } from "@/lib/api";
import { CONFIGURABLE_PERMISSIONS } from "@/lib/permissions";
import { settingsPatchSchema } from "@/lib/validations/settings";
import { getSystemSettings, updateSystemSettings, type SettingsPatch } from "@/services/system-settings.service";

export const GET = withAuth(async () => ({ ...(await getSystemSettings(true)), configurablePermissions: CONFIGURABLE_PERMISSIONS }), {
  permission: "settings:manage",
});

/** Validated in the service so no change can strand existing records. */
export const PATCH = withAuth(
  async (req, _ctx, user) => ({ ...(await updateSystemSettings(user, (await parseBody(req, settingsPatchSchema)) as SettingsPatch)), configurablePermissions: CONFIGURABLE_PERMISSIONS }),
  { permission: "settings:manage" }
);

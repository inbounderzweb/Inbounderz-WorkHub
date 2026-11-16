import { parseBody, withAuth } from "@/lib/api";
import { workloadSettingsSchema } from "@/lib/validations/workload";
import { loadSettings, updateSettings } from "@/services/workload.service";

export const GET = withAuth(async () => loadSettings(), { permission: "ticket:manage" });
export const PUT = withAuth(async (req, _ctx, user) => updateSettings(user, await parseBody(req, workloadSettingsSchema)), { permission: "settings:manage" });

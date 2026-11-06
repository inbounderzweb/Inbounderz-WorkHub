import { parseBody, withAuth } from "@/lib/api";
import { changePasswordSchema } from "@/lib/validations/auth";
import { changeOwnPassword } from "@/services/account.service";

export const POST = withAuth(async (req, _ctx, user) => {
  const { currentPassword, newPassword } = await parseBody(req, changePasswordSchema);
  await changeOwnPassword(user, currentPassword, newPassword);
  return { ok: true };
});

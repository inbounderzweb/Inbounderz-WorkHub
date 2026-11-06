import { parseBody, withPublic } from "@/lib/api";
import { resetPasswordSchema } from "@/lib/validations/auth";
import { resetPasswordWithToken } from "@/services/account.service";

export const POST = withPublic(async (req) => {
  const { token, password } = await parseBody(req, resetPasswordSchema);
  await resetPasswordWithToken(token, password);
  return { ok: true };
});

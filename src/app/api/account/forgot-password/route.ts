import { parseBody, withPublic } from "@/lib/api";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import { requestPasswordReset } from "@/services/account.service";

export const POST = withPublic(async (req) => {
  const { email } = await parseBody(req, forgotPasswordSchema);
  const baseUrl = process.env.AUTH_URL ?? req.nextUrl.origin;
  const url = await requestPasswordReset(email, baseUrl);
  if (url) {
    // EMAIL INTEGRATION POINT: send `url` to the user with your mail provider.
    // Until one is configured, the link is written to the server log only —
    // never returned in the response, so it can't be used to hijack accounts.
    console.info(`[password-reset] Reset link for ${email}: ${url}`);
  }
  // Identical response whether or not the account exists (no enumeration).
  return { ok: true, message: "If an account exists for that email, a reset link has been sent." };
});

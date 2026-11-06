import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authConfig } from "./auth.config";
import { connectDB } from "@/lib/db";
import { loginSchema } from "@/lib/validations/auth";
import { getRoleById } from "@/lib/roles";
import { User } from "@/models";
import { recordAudit } from "@/lib/audit";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
// Pre-computed hash used to keep response timing constant for unknown emails.
const DUMMY_HASH = "$2b$12$m7NGgw7KPEqLEgzgp1GpVOcxy9jGTGmn76AUsa1YB6UbupwzazvLO";

class InvalidCredentials extends CredentialsSignin {
  code = "invalid_credentials";
}
class AccountLocked extends CredentialsSignin {
  code = "account_locked";
}
class AccountInactive extends CredentialsSignin {
  code = "account_inactive";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) throw new InvalidCredentials();
        const { email, password } = parsed.data;

        await connectDB();
        const user = await User.findOne({ email }).select(
          "+passwordHash +failedLoginAttempts +lockUntil"
        );

        if (!user) {
          await bcrypt.compare(password, DUMMY_HASH);
          throw new InvalidCredentials();
        }

        if (user.lockUntil && user.lockUntil > new Date()) throw new AccountLocked();

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          const attempts = (user.failedLoginAttempts ?? 0) + 1;
          const lock = attempts >= MAX_FAILED_ATTEMPTS;
          await User.updateOne(
            { _id: user._id },
            {
              $set: {
                failedLoginAttempts: lock ? 0 : attempts,
                lockUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
              },
            }
          );
          if (lock) {
            await recordAudit({
              actorId: user._id,
              action: "auth.account_locked",
              entityType: "User",
              entityId: user._id,
              summary: `Account locked after ${MAX_FAILED_ATTEMPTS} failed sign-in attempts`,
            });
            throw new AccountLocked();
          }
          throw new InvalidCredentials();
        }

        if (user.status !== "ACTIVE") throw new AccountInactive();

        const role = await getRoleById(user.role);
        if (!role) throw new InvalidCredentials();

        await User.updateOne(
          { _id: user._id },
          { $set: { failedLoginAttempts: 0, lockUntil: null, lastLoginAt: new Date() } }
        );
        await recordAudit({
          actorId: user._id,
          action: "auth.login",
          entityType: "User",
          entityId: user._id,
          summary: `${user.name} signed in`,
        });

        return {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: role.key,
          sessionVersion: user.sessionVersion ?? 0,
        };
      },
    }),
  ],
});

import type { NextAuthConfig } from "next-auth";
import type { RoleKey } from "@/lib/constants";

/** Routes reachable without a session. */
const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password"];
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/account"];

/**
 * Edge/proxy-safe part of the Auth.js config (no database access).
 * The proxy uses it for an optimistic "is there a session?" check; the real
 * authorization (account status, role, scope) happens on the server per request.
 */
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 }, // 12h working session
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isLoggedIn = !!auth?.user;

      if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) return true;

      // Public pages decide for themselves whether to bounce a signed-in user
      // (the session cookie may belong to a since-deactivated account).
      if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;

      if (pathname.startsWith("/api/")) {
        return isLoggedIn
          ? true
          : Response.json({ error: "Authentication required" }, { status: 401 });
      }

      return isLoggedIn; // false => redirect to /login?callbackUrl=...
    },
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id as string;
        token.role = user.role;
        token.sv = user.sessionVersion;
      }
      return token;
    },
    session({ session, token }) {
      if (token.uid) {
        session.user.id = token.uid as string;
        session.user.role = token.role as RoleKey;
        session.user.sessionVersion = token.sv as number;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

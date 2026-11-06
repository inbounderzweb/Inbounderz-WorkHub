import NextAuth from "next-auth";
import type { NextFetchEvent, NextRequest } from "next/server";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

/**
 * Optimistic route protection: unauthenticated requests are redirected to
 * /login (pages) or get a 401 (API) by `authConfig.callbacks.authorized`.
 * Authoritative checks — active account, role and data scope — run on the
 * server in every page and Route Handler.
 */
export function proxy(request: NextRequest, event: NextFetchEvent) {
  return (auth as unknown as (req: NextRequest, ev: NextFetchEvent) => Promise<Response>)(request, event);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};

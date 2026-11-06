import type { DefaultSession } from "next-auth";
import type { RoleKey } from "@/lib/constants";

declare module "next-auth" {
  interface User {
    role: RoleKey;
    sessionVersion: number;
  }
  interface Session {
    user: {
      id: string;
      role: RoleKey;
      sessionVersion: number;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
    role?: RoleKey;
    sv?: number;
  }
}

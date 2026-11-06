import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { LoginForm } from "@/components/auth/login-form";
import { safeCallbackUrl } from "@/lib/safe-url";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const callbackUrl = safeCallbackUrl(typeof sp.callbackUrl === "string" ? sp.callbackUrl : undefined);
  if (await getCurrentUser()) redirect(callbackUrl);
  const reason = typeof sp.reason === "string" ? sp.reason : undefined;
  return <LoginForm callbackUrl={callbackUrl} reason={reason} />;
}

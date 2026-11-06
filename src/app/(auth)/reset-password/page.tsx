import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Reset password" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token } = await searchParams;
  if (typeof token !== "string" || token.length < 32) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Invalid reset link</h1>
        <p className="text-sm text-muted-foreground">This link is incomplete. Request a new password reset link.</p>
        <Button asChild className="w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }
  return <ResetPasswordForm token={token} />;
}

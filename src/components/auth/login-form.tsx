"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { FormRow } from "@/components/shared/form-row";
import { PasswordInput } from "@/components/shared/password-input";
import { loginSchema, type LoginInput } from "@/lib/validations/auth";

const ERRORS: Record<string, string> = {
  invalid_credentials: "Incorrect email or password.",
  account_locked: "Too many failed attempts. Your account is locked for 15 minutes.",
  account_inactive: "Your account is inactive. Contact your administrator.",
};

const NOTICES: Record<string, string> = {
  session: "Your session has ended. Please sign in again.",
  "signed-out": "You have been signed out.",
  "password-changed": "Password updated. Sign in with your new password.",
  "password-reset": "Your password has been reset. You can sign in now.",
};

export function LoginForm({ callbackUrl, reason }: { callbackUrl: string; reason?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const { register, handleSubmit, formState } = form;

  async function onSubmit(values: LoginInput) {
    setError(null);
    const res = await signIn("credentials", { ...values, redirect: false });
    if (!res || res.error) {
      setError(ERRORS[res?.code ?? ""] ?? ERRORS.invalid_credentials);
      return;
    }
    router.replace(callbackUrl);
    router.refresh();
  }

  const notice = reason ? NOTICES[reason] : undefined;

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Sign in to your Inbounderz WorkHub account.</p>
      </div>

      {notice && !error ? (
        <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-800">
          <Info className="mt-0.5 size-4 shrink-0" /> {notice}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormRow label="Work email" htmlFor="email" error={formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" placeholder="you@inbounderz.com" className="h-10" autoFocus aria-invalid={!!formState.errors.email} {...register("email")} />
        </FormRow>
        <FormRow label="Password" htmlFor="password" error={formState.errors.password?.message}>
          <PasswordInput id="password" autoComplete="current-password" placeholder="••••••••" aria-invalid={!!formState.errors.password} {...register("password")} />
        </FormRow>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="h-10 w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? <Spinner /> : null}
          Sign in
        </Button>
      </form>
      <p className="text-center text-xs text-muted-foreground">
        Accounts are created by your administrator. There is no public sign-up.
      </p>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FormRow } from "@/components/shared/form-row";
import { PasswordInput } from "@/components/shared/password-input";
import { resetPasswordSchema } from "@/lib/validations/auth";
import { api } from "@/lib/http";
import { handleFormError } from "@/lib/form";

type Values = z.input<typeof resetPasswordSchema>;

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const { register, handleSubmit, formState, setError } = useForm<Values>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: "", confirmPassword: "" },
  });

  async function onSubmit(values: Values) {
    try {
      await api("/api/account/reset-password", { method: "POST", body: values });
      router.replace("/login?reason=password-reset");
    } catch (err) {
      handleFormError(err, setError);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
        <p className="text-sm text-muted-foreground">Use at least 8 characters with upper- and lowercase letters and a number.</p>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormRow label="New password" htmlFor="password" error={formState.errors.password?.message}>
          <PasswordInput id="password" autoComplete="new-password" {...register("password")} />
        </FormRow>
        <FormRow label="Confirm password" htmlFor="confirmPassword" error={formState.errors.confirmPassword?.message}>
          <PasswordInput id="confirmPassword" autoComplete="new-password" {...register("confirmPassword")} />
        </FormRow>
        <Button type="submit" className="h-10 w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? <Spinner /> : null}
          Reset password
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        Link expired?{" "}
        <Link href="/forgot-password" className="font-medium text-primary hover:underline">
          Request a new one
        </Link>
      </p>
    </div>
  );
}

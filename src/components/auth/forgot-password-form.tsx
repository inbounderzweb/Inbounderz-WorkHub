"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { ArrowLeft, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { FormRow } from "@/components/shared/form-row";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import { api } from "@/lib/http";
import { handleFormError } from "@/lib/form";

type Values = z.input<typeof forgotPasswordSchema>;

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const { register, handleSubmit, formState, setError } = useForm<Values>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: Values) {
    try {
      await api("/api/account/forgot-password", { method: "POST", body: values });
      setSent(true);
    } catch (err) {
      handleFormError(err, setError);
    }
  }

  if (sent) {
    return (
      <div className="space-y-5">
        <span className="flex size-11 items-center justify-center rounded-full bg-accent text-primary">
          <MailCheck className="size-5" />
        </span>
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Check your inbox</h1>
          <p className="text-sm text-muted-foreground">
            If an account exists for that email, we’ve sent a link to reset your password. The link expires in 30 minutes.
          </p>
        </div>
        <Button variant="outline" className="w-full" asChild>
          <Link href="/login">
            <ArrowLeft /> Back to sign in
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Forgot your password?</h1>
        <p className="text-sm text-muted-foreground">Enter your work email and we’ll send you a reset link.</p>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormRow label="Work email" htmlFor="email" error={formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" className="h-10" autoFocus {...register("email")} />
        </FormRow>
        <Button type="submit" className="h-10 w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? <Spinner /> : null}
          Send reset link
        </Button>
      </form>
      <Link href="/login" className="flex items-center justify-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to sign in
      </Link>
    </div>
  );
}

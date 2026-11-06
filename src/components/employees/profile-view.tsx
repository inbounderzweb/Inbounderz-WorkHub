"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signOut } from "next-auth/react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { z } from "zod";
import { KeyRound, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { FormRow } from "@/components/shared/form-row";
import { PasswordInput } from "@/components/shared/password-input";
import { useCurrentUser } from "@/components/providers/user-provider";
import { changePasswordSchema } from "@/lib/validations/auth";
import { api } from "@/lib/http";
import { handleFormError } from "@/lib/form";
import { useRouter } from "next/navigation";
import { EmployeeProfile } from "./employee-profile";

const contactSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(120),
  phone: z
    .string()
    .trim()
    .max(30)
    .refine((v) => v === "" || /^[+()\-\s\d]{6,30}$/.test(v), "Enter a valid phone number"),
});
type ContactValues = z.input<typeof contactSchema>;
type PasswordValues = z.input<typeof changePasswordSchema>;

function EditContactDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const me = useCurrentUser();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { register, handleSubmit, formState, reset, setError } = useForm<ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: { name: me.name, phone: "" },
  });

  useEffect(() => {
    if (!open) return;
    api<{ name: string; phone: string }>("/api/me")
      .then((d) => reset({ name: d.name, phone: d.phone }))
      .catch(() => reset({ name: me.name, phone: "" }));
  }, [open, reset, me.name]);

  async function onSubmit(values: ContactValues) {
    try {
      await api("/api/me", { method: "PATCH", body: values });
      await mutate("/api/me");
      router.refresh(); // refresh the name in the top bar
      toast.success("Profile updated");
      onOpenChange(false);
    } catch (err) {
      handleFormError(err, setError);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit contact details</DialogTitle>
          <DialogDescription>Role, department and reporting line are managed by your administrator.</DialogDescription>
        </DialogHeader>
        <form id="contact-form" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <FormRow label="Full name" htmlFor="c-name" error={formState.errors.name?.message}>
            <Input id="c-name" {...register("name")} />
          </FormRow>
          <FormRow label="Phone" htmlFor="c-phone" error={formState.errors.phone?.message}>
            <Input id="c-phone" type="tel" {...register("phone")} />
          </FormRow>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="contact-form" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Spinner /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { register, handleSubmit, formState, reset, setError } = useForm<PasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  async function onSubmit(values: PasswordValues) {
    try {
      await api("/api/me/password", { method: "POST", body: values });
      toast.success("Password changed. Please sign in again.");
      await signOut({ redirectTo: "/login?reason=password-changed" });
    } catch (err) {
      handleFormError(err, setError);
    }
  }

  const e = formState.errors;
  return (
    <Dialog open={open} onOpenChange={(o) => !formState.isSubmitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>You’ll be signed out of all devices after changing your password.</DialogDescription>
        </DialogHeader>
        <form id="password-form" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <FormRow label="Current password" htmlFor="p-current" error={e.currentPassword?.message}>
            <PasswordInput id="p-current" autoComplete="current-password" {...register("currentPassword")} />
          </FormRow>
          <FormRow label="New password" htmlFor="p-new" error={e.newPassword?.message} description="Min. 8 characters with upper, lower case and a number.">
            <PasswordInput id="p-new" autoComplete="new-password" {...register("newPassword")} />
          </FormRow>
          <FormRow label="Confirm new password" htmlFor="p-confirm" error={e.confirmPassword?.message}>
            <PasswordInput id="p-confirm" autoComplete="new-password" {...register("confirmPassword")} />
          </FormRow>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={formState.isSubmitting}>Cancel</Button>
          <Button type="submit" form="password-form" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Spinner /> : null} Change password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProfileView() {
  const [contactOpen, setContactOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  return (
    <>
      <EmployeeProfile
        self
        headerActions={
          <>
            <Button variant="outline" size="sm" onClick={() => setContactOpen(true)}>
              <Pencil /> Edit contact
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPasswordOpen(true)}>
              <KeyRound /> Change password
            </Button>
          </>
        }
      />
      <EditContactDialog open={contactOpen} onOpenChange={setContactOpen} />
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </>
  );
}

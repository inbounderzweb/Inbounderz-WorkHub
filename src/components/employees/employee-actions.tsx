"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Copy, Wand2 } from "lucide-react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormRow } from "@/components/shared/form-row";
import { PasswordInput } from "@/components/shared/password-input";
import { adminResetPasswordSchema } from "@/lib/validations/employee";
import { api } from "@/lib/http";
import { handleFormError } from "@/lib/form";
import type { EmployeeDTO } from "@/types/dto";
import { generatePassword } from "./employee-form-dialog";

type Target = Pick<EmployeeDTO, "id" | "name" | "status">;

export function EmployeeStatusDialog({
  employee,
  onOpenChange,
  onDone,
}: {
  employee: Target | null;
  onOpenChange: (open: boolean) => void;
  onDone?: (updated: EmployeeDTO) => void;
}) {
  const deactivating = employee?.status === "ACTIVE";
  return (
    <ConfirmDialog
      open={!!employee}
      onOpenChange={onOpenChange}
      title={deactivating ? `Deactivate ${employee?.name}?` : `Reactivate ${employee?.name}?`}
      description={
        deactivating ? (
          <>They will be signed out immediately and won’t be able to sign in. Their tasks, history and records are kept.</>
        ) : (
          <>They will be able to sign in again with their existing password.</>
        )
      }
      confirmLabel={deactivating ? "Deactivate" : "Reactivate"}
      destructive={deactivating}
      onConfirm={async () => {
        if (!employee) return;
        try {
          const updated = await api<EmployeeDTO>(`/api/employees/${employee.id}/status`, {
            method: "PATCH",
            body: { status: deactivating ? "INACTIVE" : "ACTIVE" },
          });
          toast.success(deactivating ? `${employee.name} was deactivated` : `${employee.name} was reactivated`);
          onDone?.(updated);
        } catch (err) {
          handleFormError(err);
          return false;
        }
      }}
    />
  );
}

type ResetValues = z.input<typeof adminResetPasswordSchema>;

export function ResetPasswordDialog({
  employee,
  open,
  onOpenChange,
}: {
  employee: Pick<EmployeeDTO, "id" | "name">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [done, setDone] = useState<string | null>(null);
  const { register, handleSubmit, formState, setValue, setError, reset } = useForm<ResetValues>({
    resolver: zodResolver(adminResetPasswordSchema),
    defaultValues: { password: "" },
  });

  useEffect(() => {
    if (open) {
      reset({ password: "" });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the dialog when reopened
      setDone(null);
    }
  }, [open, reset]);

  async function onSubmit(values: ResetValues) {
    try {
      await api(`/api/employees/${employee.id}/password`, { method: "POST", body: values });
      setDone(values.password);
      toast.success(`Password reset for ${employee.name}`);
    } catch (err) {
      handleFormError(err, setError);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !formState.isSubmitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for {employee.name}. All of their active sessions will be signed out.
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="space-y-3">
            <p className="text-sm">Share this password with {employee.name} through a secure channel:</p>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 font-mono text-sm">
              <span className="flex-1 break-all">{done}</span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Copy password"
                onClick={async () => {
                  await navigator.clipboard.writeText(done);
                  toast.success("Copied to clipboard");
                }}
              >
                <Copy />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <FormRow label="New password" htmlFor="new-password" error={formState.errors.password?.message} description="Min. 8 characters with upper, lower case and a number.">
              <div className="flex gap-2">
                <div className="flex-1">
                  <PasswordInput id="new-password" autoComplete="new-password" {...register("password")} />
                </div>
                <Button type="button" variant="outline" className="h-9" onClick={() => setValue("password", generatePassword(), { shouldValidate: true })}>
                  <Wand2 /> Generate
                </Button>
              </div>
            </FormRow>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={formState.isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={formState.isSubmitting}>
                {formState.isSubmitting ? <Spinner /> : null}
                Reset password
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

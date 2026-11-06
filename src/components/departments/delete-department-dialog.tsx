"use client";

import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { api, ApiClientError } from "@/lib/http";

export function DeleteDepartmentDialog({
  department,
  onOpenChange,
  onDeleted,
}: {
  department: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  return (
    <ConfirmDialog
      open={!!department}
      onOpenChange={onOpenChange}
      title={`Delete ${department?.name}?`}
      description={
        <>
          This permanently deletes the department. It’s only allowed when the department has no employees, active
          projects or open tasks. Consider archiving instead to keep its history.
        </>
      }
      confirmLabel="Delete department"
      destructive
      onConfirm={async () => {
        if (!department) return;
        try {
          await api(`/api/departments/${department.id}`, { method: "DELETE" });
          toast.success(`${department.name} was deleted`);
          onDeleted?.();
        } catch (err) {
          toast.error(err instanceof ApiClientError ? err.message : "Couldn't delete the department");
          return false;
        }
      }}
    />
  );
}

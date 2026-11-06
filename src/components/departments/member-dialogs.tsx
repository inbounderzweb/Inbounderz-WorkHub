"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { EmployeePicker } from "@/components/shared/employee-picker";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useEmployeeOptions } from "@/hooks/use-options";
import { api } from "@/lib/http";
import { handleFormError } from "@/lib/form";
import type { DepartmentDetailDTO, EmployeeDTO } from "@/types/dto";

export function AddMembersDialog({
  department,
  open,
  onOpenChange,
  onDone,
}: {
  department: Pick<DepartmentDetailDTO, "id" | "name">;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const { data, isLoading } = useEmployeeOptions({ status: "ACTIVE" }, open);
  const options = data?.filter((e) => e.departmentId !== department.id);
  const moving = options?.filter((o) => selected.includes(o.id) && o.departmentId).length ?? 0;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the selection when reopened
    if (open) setSelected([]);
  }, [open]);

  async function submit() {
    setPending(true);
    try {
      const res = await api<{ added: number }>(`/api/departments/${department.id}/members`, { method: "POST", body: { add: selected } });
      toast.success(`${res.added} employee${res.added === 1 ? "" : "s"} added to ${department.name}`);
      onDone();
      onOpenChange(false);
    } catch (err) {
      handleFormError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add employees to {department.name}</DialogTitle>
          <DialogDescription>This becomes their primary department. Each employee has exactly one primary department.</DialogDescription>
        </DialogHeader>
        <EmployeePicker multiple options={options} loading={isLoading} value={selected} onChange={setSelected} placeholder="Select employees" />
        {moving > 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {moving} selected employee{moving === 1 ? " is" : "s are"} currently in another department and will be moved. Team leaders stop leading their previous department.
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !selected.length}>
            {pending ? <Spinner /> : null}
            Add {selected.length || ""} employee{selected.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveMemberDialog({
  department,
  employee,
  onOpenChange,
  onDone,
}: {
  department: Pick<DepartmentDetailDTO, "id" | "name">;
  employee: EmployeeDTO | null;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  return (
    <ConfirmDialog
      open={!!employee}
      onOpenChange={onOpenChange}
      title={`Remove ${employee?.name} from ${department.name}?`}
      description="They will have no primary department until they’re assigned to one. If they lead a team here, they stop leading it."
      confirmLabel="Remove"
      destructive
      onConfirm={async () => {
        if (!employee) return;
        try {
          await api(`/api/departments/${department.id}/members`, { method: "POST", body: { remove: [employee.id] } });
          toast.success(`${employee.name} was removed from ${department.name}`);
          onDone();
        } catch (err) {
          handleFormError(err);
          return false;
        }
      }}
    />
  );
}

export function TeamLeadersDialog({
  department,
  open,
  onOpenChange,
  onDone,
}: {
  department: DepartmentDetailDTO;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const { data, isLoading } = useEmployeeOptions({ role: "TEAM_LEADER", status: "ACTIVE" }, open);
  const options = data?.filter((e) => !e.departmentId || e.departmentId === department.id);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync selection with current leaders when opened
    if (open) setSelected(department.teamLeaders.map((t) => t.id));
  }, [open, department.teamLeaders]);

  async function submit() {
    setPending(true);
    try {
      await api(`/api/departments/${department.id}`, { method: "PATCH", body: { teamLeaders: selected } });
      toast.success("Team leaders updated");
      onDone();
      onOpenChange(false);
    } catch (err) {
      handleFormError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Team leaders</DialogTitle>
          <DialogDescription>Choose active Team Leaders who belong to {department.name}.</DialogDescription>
        </DialogHeader>
        <EmployeePicker multiple options={options} loading={isLoading} value={selected} onChange={setSelected} placeholder="Select team leaders" emptyText="No eligible Team Leaders in this department." />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Spinner /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

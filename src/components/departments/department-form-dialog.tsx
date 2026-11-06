"use client";

import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { FormRow } from "@/components/shared/form-row";
import { EmployeePicker } from "@/components/shared/employee-picker";
import { useEmployeeOptions } from "@/hooks/use-options";
import { createDepartmentSchema, type CreateDepartmentInput } from "@/lib/validations/department";
import { api } from "@/lib/http";
import { handleFormError } from "@/lib/form";
import { cn } from "@/lib/utils";
import type { DepartmentDTO } from "@/types/dto";

export const DEPARTMENT_COLORS = ["#16a34a", "#0891b2", "#2563eb", "#9333ea", "#db2777", "#ea580c", "#ca8a04", "#475569"];

function defaults(d?: DepartmentDTO): CreateDepartmentInput {
  return {
    name: d?.name ?? "",
    code: d?.code ?? "",
    description: d?.description ?? "",
    head: d?.head?.id ?? "",
    teamLeaders: d?.teamLeaders.map((t) => t.id) ?? [],
    status: d?.status ?? "ACTIVE",
    color: d?.color ?? DEPARTMENT_COLORS[0],
  };
}

export function DepartmentFormDialog({
  open,
  onOpenChange,
  department,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  department?: DepartmentDTO;
  onSaved?: (d: DepartmentDTO) => void;
}) {
  const isEdit = !!department;
  const { register, handleSubmit, control, formState, reset, setError } = useForm<CreateDepartmentInput>({
    resolver: zodResolver(createDepartmentSchema) as never,
    defaultValues: defaults(department),
  });
  useEffect(() => {
    if (open) reset(defaults(department));
  }, [open, department, reset]);

  const { data: heads, isLoading: headsLoading } = useEmployeeOptions({ role: "DEPARTMENT_HEAD", status: "ACTIVE" }, open);
  const { data: leaders, isLoading: leadersLoading } = useEmployeeOptions({ role: "TEAM_LEADER", status: "ACTIVE" }, open);
  // Team leaders must belong to this department (or be unassigned and join it).
  const leaderOptions = leaders?.filter((l) => !l.departmentId || l.departmentId === department?.id);

  async function onSubmit(values: CreateDepartmentInput) {
    const body = { ...values, head: values.head || null };
    try {
      const saved = isEdit
        ? await api<DepartmentDTO>(`/api/departments/${department.id}`, { method: "PATCH", body })
        : await api<DepartmentDTO>("/api/departments", { method: "POST", body });
      toast.success(isEdit ? "Department updated" : `${saved.name} created`);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      handleFormError(err, setError);
    }
  }

  const e = formState.errors;
  return (
    <Dialog open={open} onOpenChange={(o) => !formState.isSubmitting && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${department.name}` : "Create department"}</DialogTitle>
          <DialogDescription>Departments group employees and own the work their teams deliver.</DialogDescription>
        </DialogHeader>
        <form id="department-form" onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <FormRow label="Name" htmlFor="d-name" required error={e.name?.message}>
            <Input id="d-name" placeholder="e.g. Development" aria-invalid={!!e.name} {...register("name")} />
          </FormRow>
          <FormRow label="Code" htmlFor="d-code" required error={e.code?.message}>
            <Input id="d-code" placeholder="DEV" className="uppercase placeholder:normal-case" aria-invalid={!!e.code} {...register("code")} />
          </FormRow>
          <FormRow label="Description" htmlFor="d-desc" error={e.description?.message} className="sm:col-span-2">
            <Textarea id="d-desc" rows={3} placeholder="What does this department do?" {...register("description")} />
          </FormRow>
          <FormRow label="Color" error={e.color?.message} className="sm:col-span-2">
            <Controller
              control={control}
              name="color"
              render={({ field }) => (
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Department color">
                  {DEPARTMENT_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={field.value === c}
                      aria-label={c}
                      onClick={() => field.onChange(c)}
                      className={cn("flex size-7 items-center justify-center rounded-full ring-offset-2 transition", field.value === c && "ring-2 ring-ring")}
                      style={{ backgroundColor: c }}
                    >
                      {field.value === c ? <Check className="size-3.5 text-white" /> : null}
                    </button>
                  ))}
                </div>
              )}
            />
          </FormRow>
          <FormRow label="Department head" htmlFor="d-head" error={e.head?.message} description="Only users with the Department Head role are listed." className="sm:col-span-2">
            <Controller
              control={control}
              name="head"
              render={({ field }) => (
                <EmployeePicker id="d-head" options={heads} loading={headsLoading} value={field.value || null} onChange={(v) => field.onChange(v ?? "")} allowClear placeholder="Select a department head" emptyText="No active Department Heads. Assign the role to an employee first." invalid={!!e.head} />
              )}
            />
          </FormRow>
          <FormRow label="Team leaders" htmlFor="d-leaders" error={e.teamLeaders?.message} description="Active Team Leaders in this department or not yet assigned to one." className="sm:col-span-2">
            <Controller
              control={control}
              name="teamLeaders"
              render={({ field }) => (
                <EmployeePicker id="d-leaders" multiple options={leaderOptions} loading={leadersLoading} value={field.value ?? []} onChange={field.onChange} placeholder="Select team leaders" emptyText="No eligible Team Leaders." invalid={!!e.teamLeaders} />
              )}
            />
          </FormRow>
          {isEdit ? (
            <FormRow label="Status" htmlFor="d-status" error={e.status?.message} description="Archived departments can't receive new employees." className="sm:col-span-2">
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="d-status" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACTIVE">Active</SelectItem>
                      <SelectItem value="ARCHIVED">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </FormRow>
          ) : null}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={formState.isSubmitting}>Cancel</Button>
          <Button type="submit" form="department-form" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Spinner /> : null}
            {isEdit ? "Save changes" : "Create department"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

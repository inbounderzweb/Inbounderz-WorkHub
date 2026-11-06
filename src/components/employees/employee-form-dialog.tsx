"use client";

import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { FormRow } from "@/components/shared/form-row";
import { PasswordInput } from "@/components/shared/password-input";
import { EmployeePicker } from "@/components/shared/employee-picker";
import { useCurrentUser } from "@/components/providers/user-provider";
import { useDepartmentOptions, useEmployeeOptions } from "@/hooks/use-options";
import { createEmployeeSchema, employeeBaseSchema, type CreateEmployeeInput } from "@/lib/validations/employee";
import { ASSIGNABLE_ROLES } from "@/lib/permissions";
import { ROLE_META, type RoleKey } from "@/lib/constants";
import { api } from "@/lib/http";
import { handleFormError } from "@/lib/form";
import type { EmployeeDTO } from "@/types/dto";

const NONE = "__none";

export function generatePassword(): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "@#$%&*!"];
  const all = sets.join("");
  const rand = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  const chars = [...sets.map(rand), ...Array.from({ length: 8 }, () => rand(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function defaults(employee?: EmployeeDTO, departmentId?: string | null): CreateEmployeeInput {
  return {
    name: employee?.name ?? "",
    email: employee?.email ?? "",
    phone: employee?.phone ?? "",
    employeeId: employee?.employeeId ?? "",
    designation: employee?.designation ?? "",
    role: employee?.role?.key ?? "EMPLOYEE",
    department: employee?.department?.id ?? departmentId ?? "",
    reportingManager: employee?.reportingManager?.id ?? "",
    joiningDate: employee?.joiningDate ? employee.joiningDate.slice(0, 10) : "",
    status: employee?.status ?? "ACTIVE",
    password: "",
  };
}

export function EmployeeFormDialog({
  open,
  onOpenChange,
  employee,
  defaultDepartmentId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee?: EmployeeDTO;
  defaultDepartmentId?: string | null;
  onSaved?: (employee: EmployeeDTO) => void;
}) {
  const me = useCurrentUser();
  const isEdit = !!employee;
  const assignable = ASSIGNABLE_ROLES[me.role];
  const roleLocked = isEdit && (!employee.role || !assignable.includes(employee.role.key) || employee.id === me.id);
  const roleOptions: RoleKey[] = roleLocked && employee?.role ? [employee.role.key] : assignable;

  const form = useForm<CreateEmployeeInput>({
    resolver: zodResolver(isEdit ? employeeBaseSchema : createEmployeeSchema) as never,
    defaultValues: defaults(employee, defaultDepartmentId),
  });
  const { register, handleSubmit, control, formState, reset, setValue, setError } = form;
  const errors = formState.errors;

  useEffect(() => {
    if (open) reset(defaults(employee, defaultDepartmentId));
  }, [open, employee, defaultDepartmentId, reset]);

  const { data: departments, isLoading: deptLoading } = useDepartmentOptions(open);
  const { data: managers, isLoading: mgrLoading } = useEmployeeOptions({ status: "ACTIVE" }, open);
  const managerOptions = managers?.filter((m) => m.id !== employee?.id);

  async function onSubmit(values: CreateEmployeeInput) {
    const payload: Record<string, unknown> = {
      ...values,
      department: values.department || null,
      reportingManager: values.reportingManager || null,
      joiningDate: values.joiningDate || null,
    };
    try {
      let saved: EmployeeDTO;
      if (isEdit) {
        delete payload.password;
        delete payload.status;
        if (roleLocked) delete payload.role;
        saved = await api<EmployeeDTO>(`/api/employees/${employee.id}`, { method: "PATCH", body: payload });
        toast.success("Employee updated");
      } else {
        saved = await api<EmployeeDTO>("/api/employees", { method: "POST", body: payload });
        toast.success(`${saved.name} was added`, { description: `Employee ID ${saved.employeeId}. Share the initial password securely.` });
      }
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      handleFormError(err, setError);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !formState.isSubmitting && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${employee.name}` : "Add employee"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update employee details, role and reporting line." : "Create an account. The employee signs in with their email and the initial password."}
          </DialogDescription>
        </DialogHeader>

        <form id="employee-form" onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-2">
          <FormRow label="Full name" htmlFor="name" required error={errors.name?.message}>
            <Input id="name" autoComplete="off" aria-invalid={!!errors.name} {...register("name")} />
          </FormRow>
          <FormRow label="Work email" htmlFor="email" required error={errors.email?.message}>
            <Input id="email" type="email" autoComplete="off" aria-invalid={!!errors.email} {...register("email")} />
          </FormRow>
          <FormRow label="Phone" htmlFor="phone" error={errors.phone?.message}>
            <Input id="phone" type="tel" placeholder="+91 98765 43210" aria-invalid={!!errors.phone} {...register("phone")} />
          </FormRow>
          <FormRow label="Employee ID" htmlFor="employeeId" error={errors.employeeId?.message} description={isEdit ? undefined : "Leave blank to auto-generate (IBZ-0001…)"}>
            <Input id="employeeId" placeholder={isEdit ? undefined : "Auto-generated"} className="uppercase placeholder:normal-case" aria-invalid={!!errors.employeeId} {...register("employeeId")} />
          </FormRow>
          <FormRow label="Designation" htmlFor="designation" error={errors.designation?.message}>
            <Input id="designation" placeholder="e.g. Frontend Developer" {...register("designation")} />
          </FormRow>
          <FormRow label="Joining date" htmlFor="joiningDate" error={errors.joiningDate?.message}>
            <Input id="joiningDate" type="date" {...register("joiningDate")} />
          </FormRow>

          <FormRow label="Role" htmlFor="role" required error={errors.role?.message} description={roleLocked && isEdit ? "You can't change this employee's role." : undefined}>
            <Controller
              control={control}
              name="role"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={roleLocked}>
                  <SelectTrigger id="role" className="w-full">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_META[r].name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormRow>
          <FormRow label="Department" htmlFor="department" required={me.role !== "SUPER_ADMIN"} error={errors.department?.message}>
            <Controller
              control={control}
              name="department"
              render={({ field }) => (
                <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)} disabled={deptLoading}>
                  <SelectTrigger id="department" className="w-full" aria-invalid={!!errors.department}>
                    <SelectValue placeholder={deptLoading ? "Loading…" : "Select department"} />
                  </SelectTrigger>
                  <SelectContent>
                    {me.role === "SUPER_ADMIN" ? <SelectItem value={NONE}>No department</SelectItem> : null}
                    {departments
                      ?.filter((d) => d.status === "ACTIVE" || d.id === field.value)
                      .map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          <span className="size-2 rounded-full" style={{ backgroundColor: d.color }} />
                          {d.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormRow>

          <FormRow label="Reporting manager" htmlFor="reportingManager" error={errors.reportingManager?.message} className="sm:col-span-2">
            <Controller
              control={control}
              name="reportingManager"
              render={({ field }) => (
                <EmployeePicker
                  id="reportingManager"
                  options={managerOptions}
                  loading={mgrLoading}
                  value={field.value || null}
                  onChange={(v) => field.onChange(v ?? "")}
                  allowClear
                  placeholder="Select a manager (optional)"
                  invalid={!!errors.reportingManager}
                />
              )}
            />
          </FormRow>

          {!isEdit ? (
            <FormRow
              label="Initial password"
              htmlFor="password"
              required
              error={errors.password?.message}
              description="Min. 8 characters with upper, lower case and a number."
              className="sm:col-span-2"
            >
              <div className="flex gap-2">
                <div className="flex-1">
                  <PasswordInput id="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register("password")} />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  onClick={() => setValue("password", generatePassword(), { shouldValidate: true })}
                >
                  <Wand2 /> Generate
                </Button>
              </div>
            </FormRow>
          ) : null}
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={formState.isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="employee-form" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Spinner /> : null}
            {isEdit ? "Save changes" : "Create employee"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

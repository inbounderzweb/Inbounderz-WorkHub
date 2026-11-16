"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { EmployeePicker, type PickerOption } from "@/components/shared/employee-picker";
import { fetcher, qs } from "@/lib/http";
import type { ReviewerOptionDTO } from "@/types/dto";

/**
 * Searchable reviewer dropdown (name, photo, designation and department). Options come from the server,
 * which already limits them to eligible, active people. `excludeId` hides the assignee: nobody reviews their own work.
 */
export function ReviewerPicker({
  ticketId,
  value,
  onChange,
  excludeId,
  disabled,
  id,
  invalid,
  allowClear = true,
  placeholder = "Select a reviewer",
}: {
  ticketId: string;
  value: string | null;
  onChange: (value: string | null) => void;
  excludeId?: string | null;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
  allowClear?: boolean;
  placeholder?: string;
}) {
  const { data, isLoading, error } = useSWR<ReviewerOptionDTO[]>(`/api/tickets/reviewers${qs({ ticket: ticketId })}`, fetcher);
  const options = useMemo<PickerOption[]>(
    () =>
      (data ?? [])
        .filter((p) => p.id !== excludeId)
        .map((p) => ({
          id: p.id,
          name: p.name,
          email: p.email,
          employeeId: p.employeeId,
          avatarUrl: p.avatarUrl,
          subtitle: [p.designation || p.employeeId, p.department].filter(Boolean).join(" · "),
        })),
    [data, excludeId]
  );
  return (
    <>
      <EmployeePicker
        id={id}
        options={options}
        loading={isLoading}
        value={value}
        onChange={onChange}
        allowClear={allowClear}
        disabled={disabled}
        invalid={invalid}
        placeholder={placeholder}
        emptyText="No eligible reviewers found."
      />
      {error ? <p role="alert" className="mt-1 text-xs text-destructive">{error.message}</p> : null}
    </>
  );
}

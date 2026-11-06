"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { roleName } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { EmployeeOptionDTO } from "@/types/dto";
import { UserAvatar } from "./user-avatar";

/** Picker option: an employee, optionally with a custom subtitle (e.g. project role). */
export type PickerOption = Pick<EmployeeOptionDTO, "id" | "name" | "email" | "employeeId"> &
  Partial<Pick<EmployeeOptionDTO, "role" | "status">> & { subtitle?: string };

type BaseProps = {
  options: PickerOption[] | undefined;
  loading?: boolean;
  placeholder?: string;
  disabled?: boolean;
  emptyText?: string;
  id?: string;
  invalid?: boolean;
};

type SingleProps = BaseProps & {
  multiple?: false;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  allowClear?: boolean;
};

type MultiProps = BaseProps & {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
};

/** Searchable employee selector backed by `/api/employees?minimal=1` options. */
export function EmployeePicker(props: SingleProps | MultiProps) {
  const { options = [], loading, placeholder = "Select employee", disabled, emptyText = "No employees found.", id, invalid } = props;
  const [open, setOpen] = useState(false);
  const selected = props.multiple ? props.value : props.value ? [props.value] : [];
  const byId = new Map(options.map((o) => [o.id, o]));

  function toggle(optionId: string) {
    if (props.multiple) {
      const next = selected.includes(optionId) ? selected.filter((v) => v !== optionId) : [...selected, optionId];
      props.onChange(next);
    } else {
      props.onChange(optionId === props.value ? null : optionId);
      setOpen(false);
    }
  }

  const label = props.multiple
    ? selected.length
      ? `${selected.length} selected`
      : placeholder
    : props.value
      ? (byId.get(props.value)?.name ?? "Selected employee")
      : placeholder;

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid || undefined}
            disabled={disabled}
            className={cn("h-9 w-full justify-between font-normal", !selected.length && "text-muted-foreground")}
          >
            <span className="truncate">{label}</span>
            {loading ? <Spinner /> : <ChevronsUpDown className="opacity-50" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search by name, email or ID…" />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {!props.multiple && props.allowClear && props.value ? (
                  <CommandItem value="__clear" onSelect={() => { props.onChange(null); setOpen(false); }}>
                    <X /> Clear selection
                  </CommandItem>
                ) : null}
                {options.map((o) => (
                  <CommandItem key={o.id} value={`${o.name} ${o.email} ${o.employeeId}`} onSelect={() => toggle(o.id)}>
                    <UserAvatar name={o.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{o.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {o.subtitle ?? `${o.employeeId} · ${roleName(o.role)}`}
                        {o.status === "INACTIVE" ? " · Inactive" : ""}
                      </p>
                    </div>
                    <Check className={cn("ml-auto", selected.includes(o.id) ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {props.multiple && selected.length ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((sid) => (
            <span key={sid} className="inline-flex items-center gap-1 rounded-full border bg-secondary py-0.5 pr-1 pl-2.5 text-xs">
              {byId.get(sid)?.name ?? "Unknown"}
              <button
                type="button"
                onClick={() => toggle(sid)}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`Remove ${byId.get(sid)?.name ?? "employee"}`}
                disabled={disabled}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { TaskStatusBadge } from "@/components/shared/badges";
import { api, ApiClientError } from "@/lib/http";
import { humanize, type TaskStatus } from "@/lib/constants";

/** Friendly verb for a status transition. */
export function transitionLabel(from: TaskStatus, to: TaskStatus): string {
  if (to === "IN_REVIEW") return "Submit for review";
  if (to === "IN_PROGRESS" && from === "IN_REVIEW") return "Withdraw from review";
  if (to === "IN_PROGRESS" && (from === "COMPLETED" || from === "CANCELLED")) return "Reopen";
  if (to === "IN_PROGRESS" && from === "ON_HOLD") return "Resume work";
  if (to === "IN_PROGRESS") return "Start work";
  if (to === "ON_HOLD") return "Put on hold";
  if (to === "CANCELLED") return "Cancel task";
  if (to === "COMPLETED") return "Mark completed";
  if (to === "TODO" && from === "CANCELLED") return "Restore to To Do";
  return `Move to ${humanize(to)}`;
}

export async function changeStatus(taskId: string, status: TaskStatus, note = ""): Promise<boolean> {
  try {
    await api(`/api/tasks/${taskId}/status`, { method: "PATCH", body: { status, note } });
    toast.success(status === "IN_REVIEW" ? "Submitted for review" : `Moved to ${humanize(status)}`);
    return true;
  } catch (err) {
    toast.error(err instanceof ApiClientError ? err.message : "Couldn't update the status");
    return false;
  }
}

/** Status badge that opens a menu of the transitions this user may make. */
export function TaskStatusMenu({
  taskId,
  status,
  allowed,
  onChanged,
}: {
  taskId: string;
  status: TaskStatus;
  allowed: TaskStatus[];
  onChanged?: () => void;
}) {
  const [pending, setPending] = useState(false);
  if (!allowed.length) return <TaskStatusBadge status={status} />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="xs" className="h-auto gap-1 rounded-full p-0 hover:bg-transparent" disabled={pending} aria-label="Change status">
          <TaskStatusBadge status={status} />
          {pending ? <Spinner className="size-3" /> : <ChevronDown className="size-3 text-muted-foreground" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">Change status</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {allowed.map((s) => (
          <DropdownMenuItem
            key={s}
            onSelect={async () => {
              setPending(true);
              const ok = await changeStatus(taskId, s);
              setPending(false);
              if (ok) onChanged?.();
            }}
          >
            {transitionLabel(status, s)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

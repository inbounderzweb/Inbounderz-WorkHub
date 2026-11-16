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
import type { TaskListItemDTO } from "@/types/dto";
import { PauseDialog, useTimerControls } from "./task-timer";

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

/**
 * Status badge with a short action menu: Start / Resume, Pause (asks an optional note),
 * Submit for review and Cancel. Start and Pause drive the work timer.
 */
export function TaskStatusMenu({
  taskId,
  status,
  allowed,
  timer,
  onChanged,
}: {
  taskId: string;
  status: TaskStatus;
  allowed: TaskStatus[];
  timer?: TaskListItemDTO["liveTimer"];
  onChanged?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const c = useTimerControls(taskId, () => onChanged?.());
  const canTrack = !!timer?.canTrack;
  const running = !!timer?.running;

  // Only keep the actions people actually use; Start/Pause replace the manual In Progress / On Hold moves.
  const actions = allowed.filter((s) => {
    if (s === "IN_PROGRESS") return !canTrack || status === "IN_REVIEW" || status === "COMPLETED" || status === "CANCELLED";
    if (s === "TODO" || s === "BACKLOG" || s === "ON_HOLD") return status === "CANCELLED";
    return true;
  });

  if (!actions.length && !canTrack && !running) return <TaskStatusBadge status={status} />;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="xs" className="h-auto gap-1 rounded-full p-0 hover:bg-transparent" disabled={pending || c.busy} aria-label="Change status">
            <TaskStatusBadge status={status} />
            {pending || c.busy ? <Spinner className="size-3" /> : <ChevronDown className="size-3 text-muted-foreground" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuLabel className="text-xs text-muted-foreground">Actions</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {canTrack && !running ? (
            <DropdownMenuItem onSelect={() => c.send("START")}>{timer && timer.totalSeconds > 0 ? "Resume" : "Start"}</DropdownMenuItem>
          ) : null}
          {running ? <DropdownMenuItem onSelect={() => c.setPauseOpen(true)}>Pause</DropdownMenuItem> : null}
          {actions.map((s) => (
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
      <PauseDialog c={c} />
    </>
  );
}

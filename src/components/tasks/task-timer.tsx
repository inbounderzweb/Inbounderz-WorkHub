"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Pause, Play, Timer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/dashboard/panel";
import { api, ApiClientError } from "@/lib/http";
import type { TaskDetailDTO, TaskListItemDTO, TaskTimerDTO } from "@/types/dto";

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * The only component that re-renders every second. Elapsed time is derived from the
 * server's start timestamp (corrected for clock skew), so it is accurate after reloads,
 * across tabs, and doesn't drift when the tab is throttled in the background.
 */
/** Human total like "2 h 05 m" / "12 m 30 s". */
export function formatHuman(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} m`;
  return m > 0 ? `${m} m ${String(s % 60).padStart(2, "0")} s` : `${s} s`;
}

function LiveClock({ baseSeconds, startedAt, serverNow }: { baseSeconds: number; startedAt: string | null; serverNow: string }) {
  const [value, setValue] = useState(baseSeconds);

  useEffect(() => {
    if (!startedAt) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync static value when paused
      setValue(baseSeconds);
      return;
    }
    // Offset between the server clock (at response time) and this device's clock.
    const skewMs = new Date(serverNow).getTime() - Date.now();
    const start = new Date(startedAt).getTime();
    const tick = () => setValue(baseSeconds + (Date.now() + skewMs - start) / 1000);
    tick();
    const id = window.setInterval(() => !document.hidden && tick(), 1000);
    const onVisible = () => !document.hidden && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [baseSeconds, startedAt, serverNow]);

  return <>{formatDuration(value)}</>;
}

/** Start / pause call + optional pause-reason dialog, shared by the task page and list rows. */
export function useTimerControls(taskId: string, onChanged: () => void, kind: "task" | "ticket" = "task") {
  const [busy, setBusy] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [conflict, setConflict] = useState<string | null>(null);
  async function send(action: "START" | "PAUSE", why = "", pausePrevious = false) {
    setBusy(true);
    try {
      if (kind === "ticket") await api(`/api/tickets/${taskId}/actions`, { method: "POST", body: action === "START" ? { action: "start_timer", ...(pausePrevious ? { pausePrevious: true } : {}) } : { action: "pause_timer", message: why } });
      else await api(`/api/tasks/${taskId}/timer`, { method: "POST", body: { action, reason: why } });
      toast.success(action === "START" ? "Timer started" : "Timer paused");
      setPauseOpen(false);
      setReason("");
      setConflict(null);
      onChanged();
    } catch (err) {
      if (err instanceof ApiClientError && err.fieldErrors?.timerConflict) { setConflict(err.fieldErrors.timerConflict); return; }
      toast.error(err instanceof ApiClientError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  return { busy, pauseOpen, setPauseOpen, reason, setReason, send, conflict, setConflict };
}

/** Shown when another ticket's timer is already running: one click pauses it and continues here. */
export function TimerConflictDialog({ ticketNumber, busy, onConfirm, onCancel }: { ticketNumber: string | null; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Dialog open={!!ticketNumber} onOpenChange={(o) => !busy && !o && onCancel()}>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Another timer is running</DialogTitle>
          <DialogDescription>The timer on <strong>{ticketNumber}</strong> is still running. Only one timer can run at a time. Pause it and continue with this ticket?</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button disabled={busy} onClick={onConfirm}>{busy ? <Spinner /> : <Play />} Pause it and continue here</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PauseDialog({ c }: { c: ReturnType<typeof useTimerControls> }) {
  return (
    <Dialog open={c.pauseOpen} onOpenChange={(o) => !c.busy && c.setPauseOpen(o)}>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Pause work <span className="text-sm font-normal text-muted-foreground">(note optional)</span></DialogTitle>
          <DialogDescription>Add a short note if you like (break, waiting for design…). You can skip it. Admins and managers see it in the time log.</DialogDescription>
        </DialogHeader>
        <Textarea rows={3} value={c.reason} onChange={(e) => c.setReason(e.target.value)} maxLength={500} placeholder="Note (optional) — e.g. break, waiting for design" autoFocus />
        <DialogFooter>
          <Button variant="outline" disabled={c.busy} onClick={() => c.setPauseOpen(false)}>Cancel</Button>
          <Button disabled={c.busy} onClick={() => c.send("PAUSE", c.reason.trim())}>{c.busy ? <Spinner /> : <Pause />} Pause timer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Clockify-style compact timer for list rows: live clock + play/pause button. */
export function TaskTimerChip({ task, onChanged }: { task: TaskListItemDTO; onChanged: () => void }) {
  const t = task.liveTimer;
  const c = useTimerControls(task.id, onChanged);
  if (!t.canTrack && !t.running && t.totalSeconds === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {t.canTrack ? (
        <Button
          size="icon-sm"
          variant={t.running ? "default" : "outline"}
          className={t.running ? "bg-emerald-600 text-white hover:bg-emerald-700" : undefined}
          disabled={c.busy}
          aria-label={t.running ? "Pause timer" : t.totalSeconds > 0 ? "Continue timer" : "Start timer"}
          onClick={() => (t.running ? c.setPauseOpen(true) : c.send("START"))}
        >
          {c.busy ? <Spinner /> : t.running ? <Pause /> : <Play />}
        </Button>
      ) : null}
      {t.running || t.totalSeconds > 0 ? (
        <div className="flex min-w-0 flex-col leading-tight">
          <span className={`font-mono text-sm tabular-nums ${t.running ? "font-semibold text-emerald-600" : "text-muted-foreground"}`}>
            <LiveClock baseSeconds={t.totalSeconds} startedAt={t.running ? t.startedAt : null} serverNow={t.serverNow} />
          </span>
          {!t.running && t.pauseNote ? <span className="max-w-40 truncate text-[11px] text-muted-foreground" title={t.pauseNote}>Paused: {t.pauseNote}</span> : null}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">Not started</span>
      )}
      <PauseDialog c={c} />
    </div>
  );
}

export function TaskTimerPanel({ task, onChanged }: { task: TaskDetailDTO; onChanged: () => void }) {
  return <TimerPanel id={task.id} timer={task.timer} canTrack={task.can.trackTime} onChanged={onChanged} />;
}

/** Shared live work-timer panel for tasks and tickets. */
export function TimerPanel({ id, timer, canTrack, kind = "task", onChanged }: { id: string; timer: TaskTimerDTO; canTrack: boolean; kind?: "task" | "ticket"; onChanged: () => void }) {
  const can = { trackTime: canTrack };
  const c = useTimerControls(id, onChanged, kind);
  const { busy, send, setPauseOpen } = c;

  if (!can.trackTime && !timer.running && timer.totalSeconds === 0 && timer.log.length === 0) return null;

  return (
    <Panel title="Work timer" bodyClassName="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className={`flex items-center gap-2 font-mono text-3xl font-semibold tabular-nums ${timer.running ? "text-emerald-600" : ""}`}>
            {timer.running ? <span className="relative flex size-2.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" /><span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" /></span> : <Timer className="size-5 text-muted-foreground" />}
            <LiveClock baseSeconds={timer.totalSeconds} startedAt={timer.running ? timer.startedAt : null} serverNow={timer.serverNow} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {timer.running ? `Running${timer.by ? ` · ${timer.by.name}` : ""}` : timer.totalSeconds > 0 ? `Paused · ${formatHuman(timer.totalSeconds)} worked in total` : "Not started"}
          </p>
        </div>
        {can.trackTime ? (
          timer.running ? (
            <Button variant="outline" disabled={busy} onClick={() => setPauseOpen(true)}><Pause /> Pause</Button>
          ) : (
            <Button disabled={busy} onClick={() => send("START")}>
              {busy ? <Spinner /> : <Play />} {timer.totalSeconds > 0 ? "Continue" : "Start"}
            </Button>
          )
        ) : null}
      </div>

      {timer.log.length ? (
        <div className="border-t pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Time log</p>
          <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
            {timer.log.map((l) => (
              <li key={l.id} className="rounded-lg border bg-muted/30 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-medium tabular-nums">{formatDuration(l.seconds)}</span>
                  <span className="text-xs text-muted-foreground">{format(new Date(l.startedAt), "d MMM, HH:mm")} – {format(new Date(l.endedAt), "HH:mm")}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {l.user?.name ?? "—"} ·{" "}
                  {l.pauseReason ? <span className="text-foreground">“{l.pauseReason}”</span> : l.endKind === "AUTO" ? "Stopped automatically" : "Paused (no reason given)"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <PauseDialog c={c} />
      <TimerConflictDialog ticketNumber={c.conflict} busy={c.busy} onCancel={() => c.setConflict(null)} onConfirm={() => c.send("START", "", true)} />
    </Panel>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from "date-fns";
import { AlarmClock, ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Flag, FolderKanban, ListChecks, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useLabels } from "@/components/shared/labels";
import { fetcher, qs } from "@/lib/http";
import { day as toLocalDay } from "@/lib/dates";
import { TICKET_STATUS_LABELS, humanize, type TaskPriority, type TaskStatus, type TicketStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";

type EventType = "project" | "task" | "ticket" | "milestone";
type CalEvent = {
  id: string;
  type: EventType;
  title: string;
  ref: string;
  date: string;
  status: string;
  priority: string | null;
  overdue: boolean;
  closed: boolean;
  href: string;
  context: string;
};
type Resp = { events: CalEvent[]; overdue: CalEvent[] };

const TYPE_META: Record<EventType, { label: string; icon: typeof ListChecks; cls: string; dot: string }> = {
  project: { label: "Project deadlines", icon: FolderKanban, cls: "border-l-violet-500", dot: "bg-violet-500" },
  task: { label: "Task due dates", icon: ListChecks, cls: "border-l-sky-500", dot: "bg-sky-500" },
  ticket: { label: "Ticket due dates", icon: Ticket, cls: "border-l-fuchsia-500", dot: "bg-fuchsia-500" },
  milestone: { label: "Milestones", icon: Flag, cls: "border-l-amber-500", dot: "bg-amber-500" },
};
const TYPES = Object.keys(TYPE_META) as EventType[];
const ymd = (d: Date) => format(d, "yyyy-MM-dd");

function useStatusLabel() {
  const labels = useLabels();
  return (e: CalEvent) =>
    e.type === "task" ? labels.status(e.status as TaskStatus) : e.type === "ticket" ? TICKET_STATUS_LABELS[e.status as TicketStatus] ?? humanize(e.status) : humanize(e.status);
}

function EventChip({ e, compact }: { e: CalEvent; compact?: boolean }) {
  const meta = TYPE_META[e.type];
  const statusLabel = useStatusLabel();
  const labels = useLabels();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "block w-full truncate rounded border-l-2 bg-card px-1.5 py-0.5 text-left text-[11px] shadow-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
            meta.cls,
            e.closed && "text-muted-foreground line-through decoration-muted-foreground/50",
            e.overdue && "bg-red-50 text-red-800 hover:bg-red-100",
            !compact && "py-1 text-xs"
          )}
          title={`${e.ref} · ${e.title}`}
        >
          {e.title}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <meta.icon className="size-3.5" /> {meta.label.replace(/s$/, "")}
          <span className="font-mono">{e.ref}</span>
        </div>
        <p className="font-medium">{e.title}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Due</dt>
          <dd className={e.overdue ? "font-medium text-red-600" : undefined}>{format(toLocalDay(e.date), "EEE d MMM yyyy")}{e.overdue ? " · overdue" : ""}</dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{statusLabel(e)}</dd>
          {e.priority ? (<><dt className="text-muted-foreground">Priority</dt><dd>{labels.priority(e.priority as TaskPriority)}</dd></>) : null}
          {e.context ? (<><dt className="text-muted-foreground">Details</dt><dd>{e.context}</dd></>) : null}
        </dl>
        <Button asChild size="sm" className="w-full"><Link href={e.href}>Open <ArrowRight /></Link></Button>
      </PopoverContent>
    </Popover>
  );
}

export function CalendarView() {
  const [mode, setMode] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [types, setTypes] = useState<EventType[]>(TYPES);
  const [mine, setMine] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  // A 7-column month grid doesn't fit a phone: start with the week agenda there.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time viewport check after hydration
    if (window.matchMedia("(max-width: 767px)").matches) setMode("week");
  }, []);

  const range = useMemo(() => {
    const start = mode === "month" ? startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }) : startOfWeek(cursor, { weekStartsOn: 1 });
    const end = mode === "month" ? endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }) : endOfWeek(cursor, { weekStartsOn: 1 });
    return { start, end, days: eachDayOfInterval({ start, end }) };
  }, [mode, cursor]);

  const { data, error, isLoading, mutate } = useSWR<Resp>(
    types.length ? `/api/calendar${qs({ from: ymd(range.start), to: ymd(range.end), types: types.join(","), mine: mine ? 1 : undefined })}` : null,
    fetcher,
    { keepPreviousData: true }
  );
  const events = useMemo(() => (data?.events ?? []).filter((e) => !overdueOnly || e.overdue), [data, overdueOnly]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return m;
  }, [events]);

  const move = (n: number) => setCursor((c) => (mode === "month" ? (n > 0 ? addMonths(c, 1) : subMonths(c, 1)) : n > 0 ? addWeeks(c, 1) : subWeeks(c, 1)));
  const toggle = (t: EventType) => setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const title = mode === "month" ? format(cursor, "MMMM yyyy") : `${format(range.start, "d MMM")} – ${format(addDays(range.start, 6), "d MMM yyyy")}`;

  return (
    <div className="space-y-5">
      <PageHeader title="Calendar" description="Deadlines across the projects, tasks and tickets you can access." />

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-xs lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={() => move(-1)} aria-label={`Previous ${mode}`}><ChevronLeft /></Button>
          <Button variant="outline" size="icon-sm" onClick={() => move(1)} aria-label={`Next ${mode}`}><ChevronRight /></Button>
          <Button variant="ghost" size="sm" onClick={() => setCursor(new Date())}>Today</Button>
          <input
            type="month"
            value={format(cursor, "yyyy-MM")}
            onChange={(e) => e.target.value && setCursor(new Date(`${e.target.value}-01T00:00:00`))}
            className="h-8 rounded-md border bg-background px-2 text-sm"
            aria-label="Jump to month"
          />
          <p className="ml-1 font-semibold">{title}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {TYPES.map((t) => {
            const meta = TYPE_META[t];
            const on = types.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggle(t)}
                aria-pressed={on}
                className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors", on ? "bg-accent text-accent-foreground" : "text-muted-foreground opacity-60 hover:opacity-100")}
              >
                <span className={cn("size-2 rounded-full", meta.dot)} /> {meta.label}
              </button>
            );
          })}
          <label className="flex items-center gap-2 text-xs"><Switch checked={mine} onCheckedChange={setMine} /> Only mine</label>
          <label className="flex items-center gap-2 text-xs"><Switch checked={overdueOnly} onCheckedChange={setOverdueOnly} /> Overdue only</label>
          <Tabs value={mode} onValueChange={(v) => setMode(v as "month" | "week")}>
            <TabsList><TabsTrigger value="month">Month</TabsTrigger><TabsTrigger value="week">Week</TabsTrigger></TabsList>
          </Tabs>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          {error ? (
            <ErrorState message={error.message} onRetry={() => mutate()} />
          ) : !types.length ? (
            <EmptyState icon={CalendarDays} title="Choose at least one type of deadline" className="py-16" />
          ) : isLoading && !data ? (
            <Skeleton className="m-3 h-[520px]" />
          ) : mode === "month" ? (
            <div className="overflow-x-auto">
              <div className={cn("grid min-w-[720px] grid-cols-7", isLoading && "opacity-60")}>
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <div key={d} className="border-b bg-muted/40 px-2 py-1.5 text-xs font-medium text-muted-foreground">{d}</div>
                ))}
                {range.days.map((d) => {
                  const list = byDay.get(ymd(d)) ?? [];
                  return (
                    <div key={d.toISOString()} className={cn("min-h-28 border-b border-l p-1.5 [&:nth-child(7n+1)]:border-l-0", !isSameMonth(d, cursor) && "bg-muted/30")}>
                      <span className={cn("mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs", isToday(d) ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground")}>{format(d, "d")}</span>
                      <div className="space-y-1">
                        {list.slice(0, 4).map((e) => <EventChip key={e.id} e={e} compact />)}
                        {list.length > 4 ? (
                          <Popover>
                            <PopoverTrigger asChild><button type="button" className="px-1 text-[11px] text-muted-foreground hover:text-foreground">+{list.length - 4} more</button></PopoverTrigger>
                            <PopoverContent className="w-72 space-y-1.5">
                              <p className="text-xs font-medium">{format(d, "EEEE d MMMM")}</p>
                              {list.map((e) => <EventChip key={e.id} e={e} />)}
                            </PopoverContent>
                          </Popover>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className={cn("divide-y", isLoading && "opacity-60")}>
              {range.days.map((d) => {
                const list = byDay.get(ymd(d)) ?? [];
                return (
                  <div key={d.toISOString()} className="flex gap-4 p-3">
                    <div className="w-16 shrink-0 text-center">
                      <p className="text-xs text-muted-foreground uppercase">{format(d, "EEE")}</p>
                      <p className={cn("mx-auto mt-0.5 flex size-9 items-center justify-center rounded-full text-lg font-semibold", isToday(d) && "bg-primary text-primary-foreground")}>{format(d, "d")}</p>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      {list.length ? list.map((e) => (
                        <div key={e.id} className="flex items-center gap-2">
                          <span className={cn("size-2 shrink-0 rounded-full", TYPE_META[e.type].dot)} />
                          <span className="w-20 shrink-0 truncate font-mono text-xs text-muted-foreground">{e.ref}</span>
                          <div className="min-w-0 flex-1"><EventChip e={e} /></div>
                          <span className="hidden max-w-56 truncate text-xs text-muted-foreground md:block">{e.context}</span>
                        </div>
                      )) : <p className="py-2 text-sm text-muted-foreground">Nothing due</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <aside className="h-fit overflow-hidden rounded-xl border bg-card shadow-xs">
          <header className="flex items-center gap-2 border-b px-4 py-3">
            <AlarmClock className="size-4 text-red-600" />
            <h2 className="text-sm font-semibold">Overdue</h2>
            <span className="ml-auto text-xs text-muted-foreground">{data?.overdue.length ?? 0}</span>
          </header>
          {data?.overdue.length ? (
            <ul className="max-h-[520px] divide-y overflow-y-auto">
              {data.overdue.map((e) => (
                <li key={e.id}>
                  <Link href={e.href} className="block px-4 py-2.5 hover:bg-muted/40">
                    <p className="truncate text-sm font-medium">{e.title}</p>
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{e.ref}</span>
                      <span className="font-medium text-red-600">was due {format(toLocalDay(e.date), "d MMM")}</span>
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={AlarmClock} title="Nothing overdue" className="py-8" />
          )}
        </aside>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/states";
import { TICKET_STATUS_COLORS } from "@/components/tickets/ticket-badges";
import { TICKET_STATUS_LABELS, type TicketStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";

/* Validated categorical slots (light + dark, CVD-safe): completed, open/created, overdue. */
export const C = { done: "#16a34a", open: "#0284c7", overdue: "#dc2626", muted: "#94a3b8" };

const tooltipStyle = { borderRadius: 10, border: "1px solid var(--border)", background: "var(--popover)", color: "var(--popover-foreground)", fontSize: 12 };
const axis = { fontSize: 11, fill: "var(--muted-foreground)" };

type Col<T> = { key: keyof T & string; label: string; align?: "right" };

/** Chart card with a table view of the same rows (accessibility + exact values). */
export function ChartCard<T extends Record<string, unknown>>({
  title,
  description,
  rows,
  columns,
  children,
  className,
  empty,
}: {
  title: string;
  description?: string;
  rows: T[];
  columns: Col<T>[];
  children: React.ReactNode;
  className?: string;
  empty?: boolean;
}) {
  const [table, setTable] = useState(false);
  return (
    <section className={cn("flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs", className)}>
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{title}</h3>
          {description ? <p className="truncate text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {!empty ? (
          <Button variant="ghost" size="xs" onClick={() => setTable((t) => !t)} aria-pressed={table}>
            {table ? <BarChart3 /> : <Table2 />} {table ? "Chart" : "Table"}
          </Button>
        ) : null}
      </header>
      {empty ? (
        <EmptyState icon={BarChart3} title="No data yet" className="py-10" />
      ) : table ? (
        <div className="max-h-80 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                {columns.map((c) => <TableHead key={c.key} className={cn("first:pl-4 last:pr-4", c.align === "right" && "text-right")}>{c.label}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  {columns.map((c) => <TableCell key={c.key} className={cn("tabular text-sm first:pl-4 last:pr-4", c.align === "right" && "text-right")}>{String(r[c.key] ?? "—")}</TableCell>)}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="p-4">{children}</div>
      )}
    </section>
  );
}

/** Created vs completed tasks per month. */
export function TrendChart({ data }: { data: { label: string; created: number; completed: number }[] }) {
  return (
    <ChartCard
      title="Monthly completion trend"
      description="Tasks created vs completed per month"
      rows={data}
      columns={[{ key: "label", label: "Month" }, { key: "created", label: "Created", align: "right" }, { key: "completed", label: "Completed", align: "right" }]}
      empty={!data.some((d) => d.created || d.completed)}
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "var(--border)" }} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="created" name="Created" stroke={C.open} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="completed" name="Completed" stroke={C.done} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/** Completion % per project (single series). */
export function ProjectCompletionChart({ data, title = "Project completion", className }: { data: { name: string; code: string; progress: number; completed: number; total: number }[]; title?: string; className?: string }) {
  const rows = data.map((p) => ({ project: `${p.code} · ${p.name}`, short: p.code, progress: p.progress, completed: p.completed, total: p.total }));
  return (
    <ChartCard
      title={title}
      className={className}
      description="Completed ÷ tasks (cancelled excluded)"
      rows={rows}
      columns={[{ key: "project", label: "Project" }, { key: "progress", label: "Complete %", align: "right" }, { key: "completed", label: "Done", align: "right" }, { key: "total", label: "Tasks", align: "right" }]}
      empty={!rows.length}
    >
      <div style={{ height: Math.max(160, rows.length * 34) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 36, left: 8, bottom: 0 }} barCategoryGap={6}>
            <XAxis type="number" domain={[0, 100]} hide />
            <YAxis type="category" dataKey="short" width={72} tick={axis} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} formatter={(v) => [`${v}%`, "Complete"]} labelFormatter={(_, p) => p?.[0]?.payload?.project ?? ""} />
            <Bar dataKey="progress" name="Complete" fill={C.done} radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 11, fill: "var(--muted-foreground)", formatter: (v: unknown) => `${v}%` }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/** Completed / open / overdue per group (department or employee). Open excludes overdue so the stack adds up. */
export function StackedWorkChart({
  title,
  description,
  data,
  nameLabel,
}: {
  title: string;
  description?: string;
  data: { name: string; completed: number; open: number; overdue: number }[];
  nameLabel: string;
}) {
  const rows = data.map((d) => ({ name: d.name, completed: d.completed, onTrack: Math.max(0, d.open - d.overdue), overdue: d.overdue, open: d.open }));
  return (
    <ChartCard
      title={title}
      description={description}
      rows={rows}
      columns={[{ key: "name", label: nameLabel }, { key: "completed", label: "Completed", align: "right" }, { key: "open", label: "Open", align: "right" }, { key: "overdue", label: "Overdue", align: "right" }]}
      empty={!rows.some((r) => r.completed || r.open)}
    >
      <div style={{ height: Math.max(200, rows.length * 32) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }} barCategoryGap={6}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" width={110} tick={axis} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="completed" name="Completed" stackId="a" fill={C.done} stroke="var(--card)" strokeWidth={2} />
            <Bar dataKey="onTrack" name="Open (on track)" stackId="a" fill={C.open} stroke="var(--card)" strokeWidth={2} />
            <Bar dataKey="overdue" name="Overdue" stackId="a" fill={C.overdue} stroke="var(--card)" strokeWidth={2} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/** Internal ticket status distribution (donut with legend + totals). */
export function TicketStatusChart({ data, title = "Internal ticket status" }: { data: { status: TicketStatus; count: number }[]; title?: string }) {
  const rows = data.filter((d) => d.count > 0).map((d) => ({ status: TICKET_STATUS_LABELS[d.status], key: d.status, count: d.count }));
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <ChartCard title={title} description={`${total} ticket${total === 1 ? "" : "s"}`} rows={rows} columns={[{ key: "status", label: "Status" }, { key: "count", label: "Tickets", align: "right" }]} empty={!total}>
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <div className="relative size-44 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={rows} dataKey="count" nameKey="status" innerRadius="62%" outerRadius="100%" paddingAngle={1} stroke="var(--card)" strokeWidth={2}>
                {rows.map((r) => <Cell key={r.key} fill={TICKET_STATUS_COLORS[r.key]} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="tabular text-2xl font-semibold">{total}</span>
            <span className="text-xs text-muted-foreground">tickets</span>
          </div>
        </div>
        <ul className="grid w-full grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: TICKET_STATUS_COLORS[r.key] }} />
              <span className="truncate">{r.status}</span>
              <span className="tabular ml-auto text-muted-foreground">{r.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}

/** Hours reported per day (single series). */
export function DailyHoursChart({ data }: { data: { date: string; hours: number }[] }) {
  const rows = data.map((d) => ({ date: d.date, label: d.date.slice(5), hours: d.hours }));
  return (
    <ChartCard title="Daily work history" description="Hours reported per day · last 30 days" rows={rows} columns={[{ key: "date", label: "Date" }, { key: "hours", label: "Hours", align: "right" }]} empty={!rows.some((r) => r.hours)}>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval={4} />
            <YAxis tick={axis} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} formatter={(v) => [`${v} h`, "Hours"]} labelFormatter={(_, p) => p?.[0]?.payload?.date ?? ""} />
            <Bar dataKey="hours" name="Hours" fill={C.open} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

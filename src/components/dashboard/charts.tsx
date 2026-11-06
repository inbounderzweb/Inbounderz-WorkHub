"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { humanize } from "@/lib/constants";
import { TASK_STATUS_COLORS } from "@/components/shared/badges";
import { EmptyState } from "@/components/shared/states";
import { BarChart3, PieChart as PieIcon } from "lucide-react";
import type { DepartmentPerformance, StatusCount, WorkloadRow } from "@/services/dashboard.service";

const tooltipStyle = {
  borderRadius: 10,
  border: "1px solid var(--border)",
  boxShadow: "0 8px 24px -12px rgb(0 0 0 / 0.2)",
  fontSize: 12,
};

export function TaskStatusDonut({ data }: { data: StatusCount[] }) {
  const rows = data.filter((d) => d.count > 0);
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (!total) return <EmptyState icon={PieIcon} title="No tasks yet" description="Task distribution appears once tasks are created." className="py-10" />;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-48 w-48 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={rows} dataKey="count" nameKey="status" innerRadius={58} outerRadius={84} paddingAngle={2} strokeWidth={0}>
              {rows.map((r) => (
                <Cell key={r.status} fill={TASK_STATUS_COLORS[r.status]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [v, humanize(String(n))]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular text-2xl font-semibold">{total}</span>
          <span className="text-xs text-muted-foreground">tasks</span>
        </div>
      </div>
      <ul className="grid w-full grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-1">
        {data.map((d) => (
          <li key={d.status} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className="size-2.5 rounded-sm" style={{ backgroundColor: TASK_STATUS_COLORS[d.status] }} />
              {humanize(d.status)}
            </span>
            <span className="tabular font-medium">{d.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DepartmentPerformanceChart({ data }: { data: DepartmentPerformance[] }) {
  if (!data.length) return <EmptyState icon={BarChart3} title="No departments yet" description="Create departments to track their performance." className="py-10" />;
  const rows = data.map((d) => ({ name: d.code, fullName: d.name, Completed: d.completed, Open: d.open - d.overdue, Overdue: d.overdue }));
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barSize={22}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} labelFormatter={(_, p) => p?.[0]?.payload?.fullName ?? ""} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Completed" stackId="a" fill="var(--chart-1)" />
          <Bar dataKey="Open" stackId="a" fill="var(--chart-2)" />
          <Bar dataKey="Overdue" stackId="a" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WorkloadChart({ data }: { data: WorkloadRow[] }) {
  if (!data.length) return <EmptyState icon={BarChart3} title="No team members" description="Workload appears once employees are assigned to your team." className="py-10" />;
  const rows = data.map((d) => ({
    name: d.name.split(" ")[0],
    fullName: d.name,
    "In progress": d.inProgress,
    "In review": d.inReview,
    Other: Math.max(0, d.open - d.inProgress - d.inReview),
  }));
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }} barSize={14}>
          <CartesianGrid horizontal={false} stroke="var(--border)" />
          <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
          <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} fontSize={12} width={72} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} labelFormatter={(_, p) => p?.[0]?.payload?.fullName ?? ""} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="In progress" stackId="a" fill="var(--chart-2)" />
          <Bar dataKey="In review" stackId="a" fill="var(--chart-5)" />
          <Bar dataKey="Other" stackId="a" fill="var(--chart-1)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

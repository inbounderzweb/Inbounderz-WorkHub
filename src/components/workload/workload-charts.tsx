"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, LineChart as LineIcon, PieChart as PieIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/states";
import type { EmployeeWorkloadDTO, WorkloadCategory, WorkloadDepartmentDTO, WorkloadTrendPointDTO } from "@/types/dto";
import { CATEGORY, CATEGORY_ORDER } from "./meta";

const tooltipStyle = { borderRadius: 10, border: "1px solid var(--border)", boxShadow: "0 8px 24px -12px rgb(0 0 0 / 0.2)", fontSize: 12 };
const tick = { fontSize: 12, fill: "var(--muted-foreground)" };

/** Chart A. Clicking a slice filters the table. */
export function DistributionChart({ counts, total, selected, onSelect }: { counts: Record<WorkloadCategory, number>; total: number; selected: string; onSelect: (c: WorkloadCategory | "") => void }) {
  if (!total) return <EmptyState icon={PieIcon} title="No employees in scope" description="Employees appear once they belong to your departments or projects." className="py-10" />;
  const rows = CATEGORY_ORDER.map((c) => ({ key: c, name: CATEGORY[c].label, value: counts[c] })).filter((r) => r.value > 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-48 w-48 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="name" innerRadius={58} outerRadius={84} paddingAngle={2} strokeWidth={0} onClick={(d) => onSelect(selected === d.key ? "" : (d.key as WorkloadCategory))} cursor="pointer">
              {rows.map((r) => <Cell key={r.key} fill={CATEGORY[r.key].color} opacity={selected && selected !== r.key ? 0.35 : 1} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${v} (${Math.round((Number(v) / total) * 100)}%)`, n]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular text-2xl font-semibold">{total}</span>
          <span className="text-xs text-muted-foreground">employees</span>
        </div>
      </div>
      <ul className="grid w-full gap-1 text-sm">
        {CATEGORY_ORDER.map((c) => (
          <li key={c}>
            <button type="button" onClick={() => onSelect(selected === c ? "" : c)} aria-pressed={selected === c} className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-left hover:bg-muted/60 aria-pressed:bg-muted">
              <span className="flex items-center gap-2 text-muted-foreground"><span className="size-2.5 rounded-sm" style={{ backgroundColor: CATEGORY[c].color }} />{CATEGORY[c].label}</span>
              <span className="tabular font-medium">{counts[c]} <span className="font-normal text-muted-foreground">· {Math.round((counts[c] / total) * 100)}%</span></span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Chart B. Horizontal stacked bars per department; clicking one filters by that department. */
export function DepartmentChart({ rows, selected, onSelect }: { rows: WorkloadDepartmentDTO[]; selected: string; onSelect: (id: string) => void }) {
  if (!rows.length) return <EmptyState icon={BarChart3} title="No departments to compare" className="py-10" />;
  const data = rows.map((d) => ({ ...d, ...d.counts }));
  return (
    <div style={{ height: Math.max(180, rows.length * 44 + 40) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }} barSize={18}>
          <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis type="number" allowDecimals={false} tick={tick} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={130} tick={tick} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            contentStyle={tooltipStyle}
            content={({ active, payload }) => {
              const d = payload?.[0]?.payload as WorkloadDepartmentDTO | undefined;
              if (!active || !d) return null;
              return (
                <div style={tooltipStyle} className="space-y-0.5 bg-popover p-2.5 text-xs">
                  <p className="font-semibold">{d.name}</p>
                  <p>Total employees: <b>{d.employees}</b></p>
                  <p>No active tasks: <b>{d.none}</b></p>
                  <p>Occupied: <b>{d.occupied}</b></p>
                  <p>Overloaded: <b>{d.overloaded}</b></p>
                  <p className="text-muted-foreground">Average utilization {d.avgUtilization}%</p>
                </div>
              );
            }}
          />
          <Legend formatter={(v) => CATEGORY[v as WorkloadCategory]?.label ?? v} iconType="square" wrapperStyle={{ fontSize: 12 }} />
          {CATEGORY_ORDER.map((c) => (
            <Bar key={c} dataKey={c} stackId="d" fill={CATEGORY[c].color} cursor="pointer" onClick={(d) => onSelect(selected === (d as unknown as WorkloadDepartmentDTO).id ? "" : (d as unknown as WorkloadDepartmentDTO).id)}>
              {data.map((d) => <Cell key={d.id} opacity={selected && selected !== d.id ? 0.35 : 1} />)}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Chart C. Utilization per person (top of the current filtered, sorted list). */
export function UtilizationChart({ rows, onOpen }: { rows: EmployeeWorkloadDTO[]; onOpen: (id: string) => void }) {
  if (!rows.length) return <EmptyState icon={BarChart3} title="No employees match" description="Adjust the filters to see utilization." className="py-10" />;
  const max = Math.max(120, ...rows.map((r) => r.utilization + 10));
  return (
    <div style={{ height: Math.max(200, rows.length * 32 + 40) }}>
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 36 }} barSize={16}>
          <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis type="number" domain={[0, max]} tickFormatter={(v) => `${v}%`} tick={tick} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={110} tick={tick} axisLine={false} tickLine={false} />
          <ReferenceLine x={100} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={({ active, payload }) => {
              const r = payload?.[0]?.payload as EmployeeWorkloadDTO | undefined;
              if (!active || !r) return null;
              return (
                <div style={tooltipStyle} className="space-y-0.5 bg-popover p-2.5 text-xs">
                  <p className="font-semibold">{r.name}</p>
                  <p>{r.estimated && r.activeItems ? "~" : ""}{r.utilization}% · {CATEGORY[r.category].label}</p>
                  <p>{r.workloadHours}h of {r.capacityHours}h · {r.activeItems} active</p>
                </div>
              );
            }}
          />
          <Bar dataKey="utilization" radius={[0, 4, 4, 0]} cursor="pointer" label={{ position: "right", fontSize: 11, fill: "var(--muted-foreground)", formatter: (v: unknown) => `${v}%` }} onClick={(d) => onOpen((d as unknown as EmployeeWorkloadDTO).id)}>
            {rows.map((r) => <Cell key={r.id} fill={CATEGORY[r.category].color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Chart D. Built from assignment / completion timestamps in the database. */
export function TrendChart({ data }: { data: WorkloadTrendPointDTO[] }) {
  if (!data.length || data.every((d) => !d.active && !d.assigned && !d.completed)) return <EmptyState icon={LineIcon} title="No activity in this range" description="Assigned and completed work will chart here." className="py-10" />;
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: -12, right: 12, top: 8 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="active" name="Active (end of period)" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="assigned" name="Assigned" stroke="#64748b" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="completed" name="Completed" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="overdue" name="Overdue" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

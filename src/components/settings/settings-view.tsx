"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { BellRing, Building, Check, History, Lock, Minus, ShieldCheck, Tags, Users, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/states";
import { TableSkeleton } from "@/components/shared/skeletons";
import { FormRow } from "@/components/shared/form-row";
import { RoleBadge } from "@/components/shared/badges";
import { api, ApiClientError, fetcher } from "@/lib/http";
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission } from "@/lib/permissions";
import { OPTIONAL_TASK_STATUSES, TASK_PRIORITIES, TASK_STATUSES, humanize, type RoleKey, type TaskPriority, type TaskStatus } from "@/lib/constants";
import type { PublicSettings } from "@/lib/settings-types";
import { AuditPanel } from "./audit-panel";
import { TicketCategoriesPanel } from "./ticket-categories-panel";

type RoleOverview = {
  id: string;
  key: RoleKey;
  name: string;
  description: string;
  level: number;
  permissions: { key: Permission; label: string; base: boolean }[];
  users: number;
  activeUsers: number;
};

type FullSettings = PublicSettings & {
  permissionOverrides: Partial<Record<RoleKey, { grant?: Permission[]; revoke?: Permission[] }>>;
  reminders: { taskDueSoonHours: number; projectDueSoonDays: number };
  updatedAt: string | null;
  configurablePermissions: Permission[];
};

const GROUPS: { label: string; prefix: string[] }[] = [
  { label: "Employees", prefix: ["employee:"] },
  { label: "Departments", prefix: ["department:"] },
  { label: "Projects, tasks & tickets", prefix: ["project:", "task:", "ticket:"] },
  { label: "Daily updates", prefix: ["daily-update:"] },
  { label: "Reports & system", prefix: ["report:", "audit:", "settings:"] },
];

/** Saves one settings section and refreshes server-rendered labels. */
function useSave(onSaved: (s: FullSettings) => void) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function save(body: unknown, success: string) {
    setPending(true);
    try {
      const next = await api<FullSettings>("/api/settings", { method: "PATCH", body });
      onSaved(next);
      router.refresh();
      toast.success(success);
      return true;
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Couldn't save the settings");
      return false;
    } finally {
      setPending(false);
    }
  }
  return { pending, save };
}

/* ------------------------------------------------------------------ */

function CompanyPanel({ s, onSaved }: { s: FullSettings; onSaved: (s: FullSettings) => void }) {
  const [c, setC] = useState(s.company);
  const { pending, save } = useSave(onSaved);
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
    } catch {
      return [s.company.timezone];
    }
  }, [s.company.timezone]);
  const set = (k: keyof typeof c) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setC({ ...c, [k]: e.target.value });
  const dirty = JSON.stringify(c) !== JSON.stringify(s.company);
  return (
    <div className="rounded-xl border bg-card p-5 shadow-xs">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormRow label="Company name" htmlFor="co-name" required><Input id="co-name" value={c.name} onChange={set("name")} maxLength={120} /></FormRow>
        <FormRow label="Legal name" htmlFor="co-legal"><Input id="co-legal" value={c.legalName} onChange={set("legalName")} maxLength={200} /></FormRow>
        <FormRow label="Contact email" htmlFor="co-email"><Input id="co-email" type="email" value={c.email} onChange={set("email")} /></FormRow>
        <FormRow label="Phone" htmlFor="co-phone"><Input id="co-phone" value={c.phone} onChange={set("phone")} maxLength={40} /></FormRow>
        <FormRow label="Website" htmlFor="co-web"><Input id="co-web" value={c.website} onChange={set("website")} placeholder="https://" /></FormRow>
        <FormRow label="Timezone" htmlFor="co-tz" description="Defines “today” for daily reports and deadline reminders.">
          <Select value={c.timezone} onValueChange={(v) => setC({ ...c, timezone: v })}>
            <SelectTrigger id="co-tz" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">{zones.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}</SelectContent>
          </Select>
        </FormRow>
        <FormRow label="Address" htmlFor="co-addr" className="sm:col-span-2"><Textarea id="co-addr" rows={2} value={c.address} onChange={set("address")} maxLength={500} /></FormRow>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" disabled={!dirty || pending} onClick={() => setC(s.company)}>Reset</Button>
        <Button disabled={!dirty || pending || !c.name.trim()} onClick={() => save({ company: c }, "Company profile saved")}>{pending ? <Spinner /> : null} Save</Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function RolesPanel({ s, onSaved }: { s: FullSettings; onSaved: (s: FullSettings) => void }) {
  const { data: roles, error, isLoading, mutate } = useSWR<RoleOverview[]>("/api/roles", fetcher);
  const [eff, setEff] = useState<Record<string, Set<Permission>>>({});
  const { pending, save } = useSave((next) => { onSaved(next); mutate(); });
  const configurable = new Set(s.configurablePermissions);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync editable copy with server data
    if (roles) setEff(Object.fromEntries(roles.map((r) => [r.key, new Set(r.permissions.map((p) => p.key))])));
  }, [roles]);

  if (error) return <ErrorState message={error.message} onRetry={() => mutate()} />;
  if (isLoading || !roles) return <TableSkeleton rows={8} cols={6} />;

  const serverEff = (r: RoleOverview) => new Set(r.permissions.map((p) => p.key));
  const dirty = roles.some((r) => {
    const a = serverEff(r), b = eff[r.key];
    return !b || a.size !== b.size || [...a].some((p) => !b.has(p));
  });
  const toggle = (role: RoleKey, p: Permission, on: boolean) =>
    setEff((cur) => {
      const next = new Set(cur[role]);
      if (on) next.add(p);
      else next.delete(p);
      return { ...cur, [role]: next };
    });
  function submit() {
    const overrides: FullSettings["permissionOverrides"] = {};
    for (const r of roles!) {
      if (r.key === "SUPER_ADMIN") continue;
      const base = new Set(ROLE_PERMISSIONS[r.key]);
      const e = eff[r.key] ?? new Set();
      overrides[r.key] = {
        grant: [...e].filter((p) => !base.has(p) && configurable.has(p)),
        revoke: [...base].filter((p) => !e.has(p) && configurable.has(p)),
      };
    }
    save({ permissionOverrides: overrides }, "Permissions updated");
  }
  const allPerms = Object.keys(PERMISSIONS) as Permission[];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {roles.map((r) => (
          <div key={r.id} className="rounded-xl border bg-card p-4 shadow-xs">
            <RoleBadge role={r.key} name={r.name} />
            <p className="tabular mt-3 text-2xl font-semibold">{r.users}</p>
            <p className="text-xs text-muted-foreground">{r.activeUsers} active users</p>
            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{r.description}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Users className="size-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">User management</p>
            <p className="text-xs text-muted-foreground">Create users, assign roles and departments, activate/deactivate and reset passwords from the employee directory.</p>
          </div>
        </div>
        <Button asChild variant="outline"><Link href="/employees">Manage users</Link></Button>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">Permission settings</p>
            <p className="text-xs text-muted-foreground">
              Checkboxes can be changed. <Lock className="inline size-3" /> Locked permissions are structural and fixed, so existing projects, tasks and tickets stay consistent. Super Admin always has everything. All permissions are still limited by scope (e.g. own department).
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" disabled={!dirty || pending} onClick={() => setEff(Object.fromEntries(roles.map((r) => [r.key, serverEff(r)])))}>Reset</Button>
            <Button size="sm" disabled={!dirty || pending} onClick={submit}>{pending ? <Spinner /> : null} Save permissions</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="min-w-64 pl-4">Permission</TableHead>
                {roles.map((r) => <TableHead key={r.key} className="text-center whitespace-nowrap">{r.name}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {GROUPS.map((g) => (
                <GroupRows key={g.label} label={g.label} perms={allPerms.filter((p) => g.prefix.some((x) => p.startsWith(x)))} roles={roles} eff={eff} configurable={configurable} onToggle={toggle} />
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function GroupRows({
  label,
  perms,
  roles,
  eff,
  configurable,
  onToggle,
}: {
  label: string;
  perms: Permission[];
  roles: RoleOverview[];
  eff: Record<string, Set<Permission>>;
  configurable: Set<Permission>;
  onToggle: (role: RoleKey, p: Permission, on: boolean) => void;
}) {
  return (
    <>
      <TableRow className="bg-muted/20 hover:bg-muted/20">
        <TableCell colSpan={roles.length + 1} className="pl-4 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</TableCell>
      </TableRow>
      {perms.map((p) => (
        <TableRow key={p}>
          <TableCell className="pl-4">
            <p className="flex items-center gap-1.5 text-sm">{PERMISSIONS[p]}{!configurable.has(p) ? <Lock className="size-3 text-muted-foreground" aria-label="Fixed" /> : null}</p>
            <p className="font-mono text-[11px] text-muted-foreground">{p}</p>
          </TableCell>
          {roles.map((r) => {
            const on = eff[r.key]?.has(p) ?? false;
            const editable = configurable.has(p) && r.key !== "SUPER_ADMIN";
            const changed = editable && on !== ROLE_PERMISSIONS[r.key].includes(p);
            return (
              <TableCell key={r.key} className="text-center">
                {editable ? (
                  <span className="inline-flex items-center gap-1">
                    <Checkbox checked={on} onCheckedChange={(v) => onToggle(r.key, p, v === true)} aria-label={`${r.name}: ${PERMISSIONS[p]}`} />
                    {changed ? <span className="size-1.5 rounded-full bg-amber-500" title="Differs from the default" /> : null}
                  </span>
                ) : on ? (
                  <Check className="mx-auto size-4 text-primary" aria-label="Allowed" />
                ) : (
                  <Minus className="mx-auto size-4 text-muted-foreground/40" aria-label="Not allowed" />
                )}
              </TableCell>
            );
          })}
        </TableRow>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */

function WorkflowPanel({ s, onSaved }: { s: FullSettings; onSaved: (s: FullSettings) => void }) {
  const [statuses, setStatuses] = useState(s.taskStatuses);
  const [priorities, setPriorities] = useState(s.priorities);
  const [defaultPriority, setDefaultPriority] = useState<TaskPriority>(s.defaultPriority);
  const [daily, setDaily] = useState(s.dailyUpdates);
  const { pending, save } = useSave(onSaved);
  const dirty =
    JSON.stringify(statuses) !== JSON.stringify(s.taskStatuses) ||
    JSON.stringify(priorities) !== JSON.stringify(s.priorities) ||
    defaultPriority !== s.defaultPriority ||
    JSON.stringify(daily) !== JSON.stringify(s.dailyUpdates);

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">Task status configuration</p>
          <p className="text-xs text-muted-foreground">Rename statuses to match how your teams talk. The workflow rules (who can move a task where, reviews, ticket sync) stay the same. Optional statuses can be switched off only when no task is using them.</p>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="pl-4">Status</TableHead>
              <TableHead>Display label</TableHead>
              <TableHead className="pr-4 text-center">Offered</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {TASK_STATUSES.map((st: TaskStatus) => (
              <TableRow key={st}>
                <TableCell className="pl-4 font-mono text-xs">{st}</TableCell>
                <TableCell><Input value={statuses[st].label} maxLength={30} onChange={(e) => setStatuses({ ...statuses, [st]: { ...statuses[st], label: e.target.value } })} className="h-8 max-w-60" aria-label={`${humanize(st)} label`} /></TableCell>
                <TableCell className="pr-4 text-center">
                  {OPTIONAL_TASK_STATUSES.includes(st) ? (
                    <Switch checked={statuses[st].enabled} onCheckedChange={(v) => setStatuses({ ...statuses, [st]: { ...statuses[st], enabled: v } })} aria-label={`Offer ${humanize(st)}`} />
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3" /> Core</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">Priority settings</p>
            <p className="text-xs text-muted-foreground">Labels, and the default “required within” time used to suggest a ticket&apos;s completion date.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            Default priority
            <Select value={defaultPriority} onValueChange={(v) => setDefaultPriority(v as TaskPriority)}>
              <SelectTrigger className="w-36" aria-label="Default priority"><SelectValue /></SelectTrigger>
              <SelectContent>{TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{priorities[p].label || humanize(p)}</SelectItem>)}</SelectContent>
            </Select>
          </label>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="pl-4">Priority</TableHead>
              <TableHead>Display label</TableHead>
              <TableHead className="pr-4">Ticket response (days)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {TASK_PRIORITIES.map((p) => (
              <TableRow key={p}>
                <TableCell className="pl-4 font-mono text-xs">{p}</TableCell>
                <TableCell><Input value={priorities[p].label} maxLength={30} onChange={(e) => setPriorities({ ...priorities, [p]: { ...priorities[p], label: e.target.value } })} className="h-8 max-w-60" aria-label={`${humanize(p)} label`} /></TableCell>
                <TableCell className="pr-4"><Input type="number" min={0} max={90} value={priorities[p].responseDays} onChange={(e) => setPriorities({ ...priorities, [p]: { ...priorities[p], responseDays: Number(e.target.value) } })} className="h-8 w-24" aria-label={`${humanize(p)} response days`} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="rounded-xl border bg-card p-4 shadow-xs">
        <p className="text-sm font-semibold">Daily work updates</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <FormRow label="Allow reports for past days" htmlFor="du-back" description="0 = today only.">
            <Input id="du-back" type="number" min={0} max={31} value={daily.backdateDays} onChange={(e) => setDaily({ ...daily, backdateDays: Number(e.target.value) })} />
          </FormRow>
          <FormRow label="Maximum hours per day" htmlFor="du-max" description="Across all of an employee's reports for one day.">
            <Input id="du-max" type="number" min={1} max={24} step={0.5} value={daily.maxHoursPerDay} onChange={(e) => setDaily({ ...daily, maxHoursPerDay: Number(e.target.value) })} />
          </FormRow>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={!dirty || pending} onClick={() => { setStatuses(s.taskStatuses); setPriorities(s.priorities); setDefaultPriority(s.defaultPriority); setDaily(s.dailyUpdates); }}>Reset</Button>
        <Button
          disabled={!dirty || pending}
          onClick={() => save({ taskStatuses: statuses, priorities, defaultPriority, dailyUpdates: daily }, "Workflow settings saved")}
        >
          {pending ? <Spinner /> : null} Save workflow settings
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function NotificationRulesPanel({ s, onSaved }: { s: FullSettings; onSaved: (s: FullSettings) => void }) {
  const [r, setR] = useState(s.reminders);
  const { pending, save } = useSave(onSaved);
  const dirty = JSON.stringify(r) !== JSON.stringify(s.reminders);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-5 shadow-xs">
        <p className="text-sm font-semibold">Deadline reminders</p>
        <p className="text-xs text-muted-foreground">In-app reminders are created automatically (at most every 10 minutes while people use WorkHub, or by a scheduler calling <code className="rounded bg-muted px-1">/api/cron/reminders</code>). Each reminder is delivered once.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <FormRow label="Task “due soon” reminder (hours before)" htmlFor="rem-task">
            <Input id="rem-task" type="number" min={1} max={168} value={r.taskDueSoonHours} onChange={(e) => setR({ ...r, taskDueSoonHours: Number(e.target.value) })} />
          </FormRow>
          <FormRow label="Project deadline reminder (days before)" htmlFor="rem-proj">
            <Input id="rem-proj" type="number" min={1} max={30} value={r.projectDueSoonDays} onChange={(e) => setR({ ...r, projectDueSoonDays: Number(e.target.value) })} />
          </FormRow>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" disabled={!dirty || pending} onClick={() => setR(s.reminders)}>Reset</Button>
          <Button disabled={!dirty || pending} onClick={() => save({ reminders: r }, "Reminder settings saved")}>{pending ? <Spinner /> : null} Save</Button>
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">Personal notification preferences</p>
          <p className="text-xs text-muted-foreground">Each user chooses which notification categories they receive. New work assigned to someone is always delivered.</p>
        </div>
        <Button asChild variant="outline"><Link href="/notifications?tab=preferences">Open my preferences</Link></Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function SettingsView() {
  const { data, error, isLoading, mutate } = useSWR<FullSettings>("/api/settings", fetcher);
  const onSaved = (s: FullSettings) => mutate(s, { revalidate: false });

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="Company profile, users and permissions, workflow configuration, ticket categories, notifications and the audit trail." />
      {error ? (
        <div className="rounded-xl border bg-card"><ErrorState message={error.message} onRetry={() => mutate()} /></div>
      ) : isLoading || !data ? (
        <TableSkeleton rows={8} cols={4} />
      ) : (
        <Tabs defaultValue="company" className="gap-4">
          <div className="overflow-x-auto">
            <TabsList>
              <TabsTrigger value="company"><Building /> Company</TabsTrigger>
              <TabsTrigger value="roles"><ShieldCheck /> Users & roles</TabsTrigger>
              <TabsTrigger value="workflow"><Workflow /> Workflow</TabsTrigger>
              <TabsTrigger value="tickets"><Tags /> Ticket categories</TabsTrigger>
              <TabsTrigger value="notifications"><BellRing /> Notifications</TabsTrigger>
              <TabsTrigger value="audit"><History /> Audit log</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="company"><CompanyPanel s={data} onSaved={onSaved} /></TabsContent>
          <TabsContent value="roles"><RolesPanel s={data} onSaved={onSaved} /></TabsContent>
          <TabsContent value="workflow"><WorkflowPanel s={data} onSaved={onSaved} /></TabsContent>
          <TabsContent value="tickets"><TicketCategoriesPanel /></TabsContent>
          <TabsContent value="notifications"><NotificationRulesPanel s={data} onSaved={onSaved} /></TabsContent>
          <TabsContent value="audit"><AuditPanel /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}

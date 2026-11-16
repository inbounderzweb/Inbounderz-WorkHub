"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { FormRow } from "@/components/shared/form-row";
import { api, ApiClientError } from "@/lib/http";
import type { WorkloadSettingsDTO } from "@/types/dto";

const FIELDS: { key: keyof WorkloadSettingsDTO; label: string; hint: string; step?: string; scale?: number }[] = [
  { key: "hoursPerDay", label: "Working hours per day", hint: "Capacity = hours per day × days per week" },
  { key: "daysPerWeek", label: "Working days per week", hint: "The monthly view uses 4 weeks" },
  { key: "moderateFrom", label: "Moderate workload from (%)", hint: "Below this is Low workload" },
  { key: "highFrom", label: "High workload from (%)", hint: "Shown as Fully Occupied" },
  { key: "overloadedAbove", label: "Overloaded above (%)", hint: "Strictly above this" },
  { key: "onHoldWeight", label: "On-hold work counts as (%)", hint: "Share of its hours still counted", step: "5", scale: 100 },
  { key: "reviewWeight", label: "Work in review counts as (%)", hint: "Waiting on someone else", step: "5", scale: 100 },
  { key: "fallbackHours", label: "Hours for un-estimated work", hint: "Utilization is then marked as an estimate" },
];

/** Super Admin only: thresholds and capacity rules the whole workload view (and ticket assignment) uses. */
export function WorkloadSettingsDialog({ settings, onSaved }: { settings: WorkloadSettingsDTO; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const start = () => {
    setForm(Object.fromEntries(FIELDS.map((f) => [f.key, String(Math.round(settings[f.key] * (f.scale ?? 1)))])));
    setError("");
    setOpen(true);
  };
  const save = async () => {
    const body = Object.fromEntries(FIELDS.map((f) => [f.key, Number(form[f.key]) / (f.scale ?? 1)]));
    if (Object.values(body).some((v) => Number.isNaN(v))) return setError("Enter a number in every field");
    setPending(true);
    setError("");
    try {
      await api("/api/workload/settings", { method: "PUT", body });
      toast.success("Workload settings saved");
      setOpen(false);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't save settings");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={start}><Settings2 /> Thresholds</Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Workload settings</DialogTitle>
            <DialogDescription>Applies to the dashboard and to the workload shown when assigning tickets.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <FormRow key={f.key} label={f.label} htmlFor={`ws-${f.key}`} description={f.hint}>
                <Input id={`ws-${f.key}`} type="number" inputMode="decimal" step={f.step ?? "1"} min={0} value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              </FormRow>
            ))}
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button onClick={save} disabled={pending}>{pending ? <Spinner /> : null} Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

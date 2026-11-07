"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ErrorState } from "@/components/shared/states";
import { TableSkeleton } from "@/components/shared/skeletons";
import { api, ApiClientError, fetcher } from "@/lib/http";
import { NOTIFICATION_PREFS, type NotificationPref } from "@/lib/constants";

/** The signed-in user's own in-app notification preferences. */
export function NotificationPreferences() {
  const { data, error, isLoading, mutate } = useSWR<{ muted: NotificationPref[] }>("/api/me/notification-preferences", fetcher);
  const [muted, setMuted] = useState<NotificationPref[]>([]);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync editable copy with server data
    if (data) setMuted(data.muted);
  }, [data]);
  if (error) return <ErrorState message={error.message} onRetry={() => mutate()} />;
  if (isLoading || !data) return <TableSkeleton rows={6} cols={2} />;
  const dirty = [...muted].sort().join() !== [...data.muted].sort().join();

  async function save() {
    setPending(true);
    try {
      await mutate(await api("/api/me/notification-preferences", { method: "PUT", body: { muted } }), { revalidate: false });
      toast.success("Notification preferences saved");
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Couldn't save your preferences");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <ul className="divide-y">
        <li className="flex items-center gap-4 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-medium">New work assigned to you <Lock className="size-3 text-muted-foreground" /></p>
            <p className="text-xs text-muted-foreground">Tasks and internal requests assigned to you, review decisions on your work and requests that need your answer. Always delivered.</p>
          </div>
          <Switch checked disabled aria-label="Assignments (always on)" />
        </li>
        {NOTIFICATION_PREFS.map((p) => {
          const on = !muted.includes(p.key);
          return (
            <li key={p.key} className="flex items-center gap-4 px-4 py-3.5">
              <label htmlFor={`pref-${p.key}`} className="min-w-0 flex-1 cursor-pointer">
                <p className="text-sm font-medium">{p.label}</p>
                <p className="text-xs text-muted-foreground">{p.description}</p>
              </label>
              <Switch id={`pref-${p.key}`} checked={on} onCheckedChange={(v) => setMuted((cur) => (v ? cur.filter((k) => k !== p.key) : [...cur, p.key]))} />
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end gap-2 border-t px-4 py-3">
        <Button variant="outline" disabled={!dirty || pending} onClick={() => setMuted(data.muted)}>Reset</Button>
        <Button disabled={!dirty || pending} onClick={save}>{pending ? <Spinner /> : null} Save preferences</Button>
      </div>
    </div>
  );
}

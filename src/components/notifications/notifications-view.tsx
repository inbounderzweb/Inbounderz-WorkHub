"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { format, formatDistanceToNow } from "date-fns";
import { Bell, CheckCheck, Circle, MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/shared/page-header";
import { DataPagination } from "@/components/shared/data-pagination";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TableSkeleton } from "@/components/shared/skeletons";
import { NOTIFICATIONS_KEY } from "@/components/layout/notifications-menu";
import { api, fetcher, qs } from "@/lib/http";
import { NOTIFICATION_TYPES, humanize } from "@/lib/constants";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NotificationPreferences } from "./notification-preferences";
import { cn } from "@/lib/utils";
import type { NotificationDTO, Paginated } from "@/types/dto";

type Resp = Paginated<NotificationDTO> & { unreadCount: number };

export function NotificationsView() {
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();
  const params = useSearchParams();
  const [tab, setTab] = useState<"all" | "unread" | "preferences">(params.get("tab") === "preferences" ? "preferences" : "all");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, isLoading, mutate } = useSWR<Resp>(
    `/api/notifications${qs({ page, pageSize: 15, unread: tab === "unread" ? 1 : undefined, type })}`,
    fetcher,
    { keepPreviousData: true }
  );

  const refresh = () => {
    mutate();
    globalMutate(NOTIFICATIONS_KEY);
  };

  async function run(fn: () => Promise<unknown>, success?: string) {
    try {
      await fn();
      if (success) toast.success(success);
      refresh();
    } catch {
      toast.error("Something went wrong. Please try again.");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description={data ? `${data.unreadCount} unread` : "Updates about your work and account"}
        actions={
          <Button
            variant="outline"
            disabled={!data?.unreadCount}
            onClick={() => run(() => api("/api/notifications", { method: "PATCH", body: { action: "mark-all-read" } }), "All notifications marked as read")}
          >
            <CheckCheck /> Mark all read
          </Button>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={tab} onValueChange={(v) => { setTab(v as typeof tab); setPage(1); }}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="unread">Unread{data?.unreadCount ? ` (${data.unreadCount})` : ""}</TabsTrigger>
            <TabsTrigger value="preferences">Preferences</TabsTrigger>
          </TabsList>
        </Tabs>
        {tab !== "preferences" ? (
          <Select value={type || "__all"} onValueChange={(v) => { setType(v === "__all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-44" aria-label="Notification type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All types</SelectItem>
              {NOTIFICATION_TYPES.map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {tab === "preferences" ? <NotificationPreferences /> : (
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        {error ? (
          <ErrorState message={error.message} onRetry={() => mutate()} />
        ) : isLoading && !data ? (
          <TableSkeleton rows={6} cols={3} />
        ) : !data?.items.length ? (
          <EmptyState icon={Bell} title={tab === "unread" ? "No unread notifications" : "No notifications yet"} description="You’re all caught up." />
        ) : (
          <>
            <ul className="divide-y">
              {data.items.map((n) => (
                <li key={n.id} className={cn("flex items-start gap-3 px-4 py-3.5", !n.isRead && "bg-accent/30")}>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.isRead ? "bg-border" : "bg-primary")} />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={async () => {
                      if (!n.isRead) await api(`/api/notifications/${n.id}`, { method: "PATCH", body: { isRead: true } }).catch(() => null);
                      refresh();
                      if (n.link) router.push(n.link);
                    }}
                  >
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {n.title}
                      <span className="rounded-full border px-1.5 py-px text-[10px] font-medium text-muted-foreground">{humanize(n.type)}</span>
                    </p>
                    {n.message ? <p className="text-sm text-muted-foreground">{n.message}</p> : null}
                    <p className="mt-1 text-xs text-muted-foreground" title={format(new Date(n.createdAt), "PPpp")}>
                      {n.actor ? `${n.actor.name} · ` : ""}
                      {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                    </p>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label="Notification actions">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => run(() => api(`/api/notifications/${n.id}`, { method: "PATCH", body: { isRead: !n.isRead } }))}>
                        <Circle /> Mark as {n.isRead ? "unread" : "read"}
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => run(() => api(`/api/notifications/${n.id}`, { method: "DELETE" }), "Notification deleted")}>
                        <Trash2 /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
            <DataPagination page={data.page} pageSize={data.pageSize} total={data.total} totalPages={data.totalPages} onPageChange={setPage} label="notifications" />
          </>
        )}
      </div>
      )}
    </div>
  );
}

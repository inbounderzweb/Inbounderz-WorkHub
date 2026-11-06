"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { formatDistanceToNow } from "date-fns";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/states";
import { api, fetcher } from "@/lib/http";
import { cn } from "@/lib/utils";
import type { NotificationDTO, Paginated } from "@/types/dto";
import { toast } from "sonner";

type Resp = Paginated<NotificationDTO> & { unreadCount: number };
export const NOTIFICATIONS_KEY = "/api/notifications?pageSize=8";

export function NotificationsMenu() {
  const router = useRouter();
  const { data, isLoading, mutate } = useSWR<Resp>(NOTIFICATIONS_KEY, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
  });
  const unread = data?.unreadCount ?? 0;

  async function open(n: NotificationDTO) {
    if (!n.isRead) {
      await api(`/api/notifications/${n.id}`, { method: "PATCH", body: { isRead: true } }).catch(() => null);
      mutate();
    }
    if (n.link) router.push(n.link);
  }

  async function markAll() {
    try {
      await api("/api/notifications", { method: "PATCH", body: { action: "mark-all-read" } });
      await mutate();
    } catch {
      toast.error("Couldn't mark notifications as read");
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}>
          <Bell className="size-4.5" />
          {unread > 0 ? (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          <Button variant="ghost" size="xs" onClick={markAll} disabled={!unread}>
            <CheckCheck /> Mark all read
          </Button>
        </div>
        <div className="max-h-[380px] overflow-y-auto scrollbar-thin">
          {isLoading ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : !data?.items.length ? (
            <EmptyState icon={Bell} title="You're all caught up" description="New notifications will appear here." className="py-10" />
          ) : (
            <ul className="divide-y">
              {data.items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => open(n)}
                    className={cn("flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60", !n.isRead && "bg-accent/40")}
                  >
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.isRead ? "bg-transparent" : "bg-primary")} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{n.title}</span>
                      {n.message ? <span className="line-clamp-2 block text-xs text-muted-foreground">{n.message}</span> : null}
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t p-2">
          <Button variant="ghost" size="sm" className="w-full" asChild>
            <Link href="/notifications">View all notifications</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

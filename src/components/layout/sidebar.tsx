"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCurrentUser } from "@/components/providers/user-provider";
import { fetcher } from "@/lib/http";
import { hasPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { NAV } from "./nav";

export function SidebarNav({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const user = useCurrentUser();
  // Items waiting on this user, per nav href. Refreshes every minute and when the tab regains focus.
  const { data: counts } = useSWR<Record<string, number>>("/api/nav-counts", fetcher, { refreshInterval: 60_000, revalidateOnFocus: true });

  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4 scrollbar-thin" aria-label="Main">
      {NAV.map((section) => {
        const items = section.items.filter((i) => !i.permission || hasPermission(user.role, i.permission));
        if (!items.length) return null;
        return (
          <div key={section.label} className="space-y-1">
            {!collapsed ? (
              <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase">
                {section.label}
              </p>
            ) : (
              <div className="mx-auto mb-1 h-px w-6 bg-sidebar-border" />
            )}
            {items.map((item) => {
              // The Review queue lives under /tickets, so "Tickets" must not light up on that page.
              const active = pathname === item.href || (pathname.startsWith(`${item.href}/`) && !(item.href === "/tickets" && pathname.startsWith("/tickets/reviews")));
              const count = counts?.[item.href] ?? 0;
              const badge = count > 99 ? "99+" : String(count);
              const link = (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm font-medium text-sidebar-foreground/80 transition-colors",
                    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    active && "bg-sidebar-accent text-sidebar-accent-foreground",
                    collapsed && "justify-center px-0"
                  )}
                >
                  <item.icon className={cn("size-4.5 shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-primary")} />
                  {!collapsed ? <span className="truncate">{item.label}</span> : <span className="sr-only">{item.label}</span>}
                  {count > 0 ? (
                    <span
                      className={cn(
                        "flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground",
                        collapsed ? "absolute top-0.5 right-1.5" : "ml-auto"
                      )}
                      aria-label={`${count} waiting`}
                    >
                      {badge}
                    </span>
                  ) : null}
                </Link>
              );
              return collapsed ? (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">{count > 0 ? `${item.label} (${count})` : item.label}</TooltipContent>
                </Tooltip>
              ) : (
                link
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 lg:flex",
        collapsed ? "w-[68px]" : "w-64"
      )}
    >
      <div className={cn("flex h-16 items-center border-b px-4", collapsed && "justify-center px-0")}>
        <Link href="/dashboard" aria-label="Inbounderz WorkHub home">
          <Logo collapsed={collapsed} />
        </Link>
      </div>
      <SidebarNav collapsed={collapsed} />
      <div className={cn("border-t p-3", collapsed && "flex justify-center")}>
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "sm"}
          onClick={onToggle}
          className={cn("text-muted-foreground", !collapsed && "w-full justify-start")}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          {!collapsed ? "Collapse" : null}
        </Button>
      </div>
    </aside>
  );
}

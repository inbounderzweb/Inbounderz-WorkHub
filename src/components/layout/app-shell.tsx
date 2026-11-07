"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { SWRConfig } from "swr";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { UserProvider, type ClientUser } from "@/components/providers/user-provider";
import type { PublicSettings } from "@/lib/settings-types";
import { Sidebar, SidebarNav } from "./sidebar";
import { Logo } from "./logo";
import { GlobalSearch } from "./global-search";
import { NotificationsMenu } from "./notifications-menu";
import { UserMenu } from "./user-menu";

const COLLAPSE_KEY = "workhub.sidebar.collapsed";

export function AppShell({ user, settings, children }: { user: ClientUser; settings: PublicSettings; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read persisted preference after hydration
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- close the drawer on navigation
    setMobileOpen(false);
  }, [pathname]);

  const toggle = () =>
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      return !c;
    });

  return (
    <UserProvider user={user} settings={settings}>
      <SWRConfig value={{ revalidateOnFocus: false, shouldRetryOnError: false }}>
        <div className="flex min-h-dvh">
          <Sidebar collapsed={collapsed} onToggle={toggle} />

          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent side="left" className="flex w-72 flex-col gap-0 bg-sidebar p-0">
              <SheetHeader className="h-16 justify-center border-b px-4">
                <SheetTitle asChild>
                  <div>
                    <Logo />
                  </div>
                </SheetTitle>
              </SheetHeader>
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-6">
              <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
                <Menu />
              </Button>
              <div className="flex min-w-0 flex-1 items-center">
                <GlobalSearch />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <NotificationsMenu />
                <UserMenu />
              </div>
            </header>
            <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
          </div>
        </div>
      </SWRConfig>
    </UserProvider>
  );
}

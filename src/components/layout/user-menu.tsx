"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { useState } from "react";
import { ChevronDown, LogOut, Settings, UserCircle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/shared/user-avatar";
import { RoleBadge } from "@/components/shared/badges";
import { useCurrentUser } from "@/components/providers/user-provider";
import { hasPermission } from "@/lib/permissions";

export function UserMenu() {
  const user = useCurrentUser();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg p-1 pr-2 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
        <UserAvatar name={user.name} src={user.avatarUrl} />
        <span className="hidden text-left leading-tight md:block">
          <span className="block max-w-36 truncate text-sm font-medium">{user.name}</span>
          <span className="block text-xs text-muted-foreground">{user.roleName}</span>
        </span>
        <ChevronDown className="hidden size-3.5 text-muted-foreground md:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="space-y-1.5 font-normal">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          <RoleBadge role={user.role} name={user.roleName} />
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <UserCircle /> My profile
          </Link>
        </DropdownMenuItem>
        {hasPermission(user.role, "settings:manage") ? (
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <Settings /> Settings
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={signingOut}
          onSelect={async (e) => {
            e.preventDefault();
            setSigningOut(true);
            await signOut({ redirectTo: "/login?reason=signed-out" });
          }}
        >
          <LogOut /> {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

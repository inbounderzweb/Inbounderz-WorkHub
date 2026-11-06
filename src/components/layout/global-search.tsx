"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Building2, FolderKanban, Search, User } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Spinner } from "@/components/ui/spinner";
import { useDebounce } from "@/hooks/use-debounce";
import { fetcher, qs } from "@/lib/http";
import type { SearchResultDTO } from "@/types/dto";
import { NAV } from "./nav";
import { useCurrentUser } from "@/components/providers/user-provider";
import { hasPermission } from "@/lib/permissions";

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = useDebounce(query.trim(), 250);
  const router = useRouter();
  const user = useCurrentUser();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { data, isLoading } = useSWR<SearchResultDTO>(q.length >= 2 ? `/api/search${qs({ q })}` : null, fetcher, {
    keepPreviousData: true,
  });

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  const pages = NAV.flatMap((s) => s.items).filter((i) => !i.permission || hasPermission(user.role, i.permission));
  const hasResults = !!data && (data.employees.length || data.departments.length || data.projects.length);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full min-w-0 max-w-md items-center gap-2 rounded-lg border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="size-4" />
        <span className="flex-1 truncate text-left">Search employees, departments…</span>
        <kbd className="hidden rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] sm:inline">⌘K</kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Search across WorkHub">
        <Command shouldFilter={false}>
        <CommandInput placeholder="Type at least 2 characters…" value={query} onValueChange={setQuery} />
        <CommandList>
          {q.length < 2 ? (
            <CommandGroup heading="Go to">
              {pages.map((p) => (
                <CommandItem key={p.href} value={p.href} onSelect={() => go(p.href)}>
                  <p.icon /> {p.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : isLoading && !data ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Spinner /> Searching…
            </div>
          ) : !hasResults ? (
            <CommandEmpty>No results for “{q}”.</CommandEmpty>
          ) : (
            <>
              {data!.employees.length ? (
                <CommandGroup heading="Employees">
                  {data!.employees.map((e) => (
                    <CommandItem key={e.id} value={`emp-${e.id}`} onSelect={() => go(`/employees/${e.id}`)}>
                      <User />
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{e.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {e.employeeId} · {e.email}
                          {e.department ? ` · ${e.department}` : ""}
                        </p>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {data!.departments.length ? (
                <CommandGroup heading="Departments">
                  {data!.departments.map((d) => (
                    <CommandItem key={d.id} value={`dept-${d.id}`} onSelect={() => go(`/departments/${d.id}`)}>
                      <Building2 />
                      <span className="flex-1 truncate">{d.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{d.code}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {data!.projects.length ? (
                <CommandGroup heading="Projects">
                  {data!.projects.map((p) => (
                    <CommandItem key={p.id} value={`proj-${p.id}`} disabled>
                      <FolderKanban />
                      <span className="flex-1 truncate">{p.name}</span>
                      <span className="text-xs text-muted-foreground">Project pages arrive with the Projects module</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </>
          )}
        </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const TONES = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  blue: "bg-sky-50 text-sky-700 ring-sky-100",
  violet: "bg-violet-50 text-violet-700 ring-violet-100",
  amber: "bg-amber-50 text-amber-700 ring-amber-100",
  red: "bg-red-50 text-red-700 ring-red-100",
  slate: "bg-slate-50 text-slate-700 ring-slate-100",
} as const;

export type StatTone = keyof typeof TONES;

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "green",
  hint,
  href,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: StatTone;
  hint?: React.ReactNode;
  href?: string;
}) {
  const body = (
    <div
      className={cn(
        "group flex h-full items-start justify-between gap-3 rounded-xl border bg-card p-4 shadow-xs transition-colors",
        href && "hover:border-primary/40 hover:bg-accent/30"
      )}
    >
      <div className="min-w-0 space-y-1">
        <p className="truncate text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="tabular text-2xl font-semibold tracking-tight">{value}</p>
        {hint ? <p className="truncate text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg ring-1", TONES[tone])}>
        <Icon className="size-4.5" />
      </span>
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      {body}
    </Link>
  ) : (
    body
  );
}

export function StatCardSkeleton() {
  return (
    <div className="flex items-start justify-between rounded-xl border bg-card p-4">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-14" />
      </div>
      <Skeleton className="size-9 rounded-lg" />
    </div>
  );
}

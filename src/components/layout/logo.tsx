import { cn } from "@/lib/utils";

export function Logo({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <svg viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 19V9" />
          <path d="M12 19V5" />
          <path d="M19 19v-7" />
        </svg>
      </span>
      {!collapsed ? (
        <span className="leading-none">
          <span className="block text-[15px] font-semibold tracking-tight">Inbounderz</span>
          <span className="block text-[11px] font-medium tracking-wide text-primary uppercase">WorkHub</span>
        </span>
      ) : null}
    </div>
  );
}

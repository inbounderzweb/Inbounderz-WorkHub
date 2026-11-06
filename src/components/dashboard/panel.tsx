import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Panel({
  title,
  description,
  href,
  hrefLabel = "View all",
  action,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  description?: string;
  href?: string;
  hrefLabel?: string;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs", className)}>
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {description ? <p className="truncate text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action}
        {href ? (
          <Link href={href} className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline">
            {hrefLabel} <ArrowRight className="size-3" />
          </Link>
        ) : null}
      </header>
      <div className={cn("flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

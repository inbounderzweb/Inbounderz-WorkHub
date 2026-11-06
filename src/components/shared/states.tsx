import { AlertTriangle, type LucideIcon, Inbox, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      <span className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Icon className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Couldn't load this data",
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      <span className="flex size-11 items-center justify-center rounded-full bg-red-50 text-red-600">
        <AlertTriangle className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {message ? <p className="max-w-sm text-sm text-muted-foreground">{message}</p> : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw /> Try again
        </Button>
      ) : null}
    </div>
  );
}

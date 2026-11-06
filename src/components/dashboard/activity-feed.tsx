import { formatDistanceToNow } from "date-fns";
import { Activity } from "lucide-react";
import type { ActivityDTO } from "@/types/dto";
import { UserAvatar } from "@/components/shared/user-avatar";
import { EmptyState } from "@/components/shared/states";

export function ActivityFeed({ items }: { items: ActivityDTO[] }) {
  if (!items.length) return <EmptyState icon={Activity} title="No activity yet" description="Changes across WorkHub will appear here." className="py-10" />;
  return (
    <ol className="divide-y">
      {items.map((a) => (
        <li key={a.id} className="flex gap-3 px-4 py-3">
          <UserAvatar name={a.actor?.name ?? "System"} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-snug">{a.summary || a.action}</p>
            <p className="text-xs text-muted-foreground">
              {a.actor?.name ?? "System"} · {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

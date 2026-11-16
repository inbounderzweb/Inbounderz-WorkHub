import { REVIEW_STATUS_LABELS, type ReviewStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";

const STYLE: Record<ReviewStatus, string> = {
  NONE: "border-muted bg-muted/40 text-muted-foreground",
  PENDING: "border-violet-200 bg-violet-50 text-violet-700",
  CHANGES_REQUESTED: "border-orange-200 bg-orange-50 text-orange-700",
  APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

/** Pending review / Changes requested / Approved, independent of the ticket status. */
export function ReviewStatusBadge({ status, className }: { status: ReviewStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", STYLE[status], className)}>
      {REVIEW_STATUS_LABELS[status]}
    </span>
  );
}

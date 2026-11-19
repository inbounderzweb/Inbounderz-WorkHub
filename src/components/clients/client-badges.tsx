import { cn } from "@/lib/utils";
import { humanize, type ClientStatus } from "@/lib/constants";

const STYLES: Record<ClientStatus, string> = {
  PROSPECT: "border-sky-200 bg-sky-50 text-sky-700",
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  INACTIVE: "border-slate-200 bg-slate-100 text-slate-600",
  ARCHIVED: "border-amber-200 bg-amber-50 text-amber-700",
};

export function ClientStatusBadge({ status }: { status: ClientStatus }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", STYLES[status])}>{humanize(status)}</span>;
}

import { REQUIREMENT_STATUS_LABELS, type RequirementStatus } from "@/lib/constants";

const REQUIREMENT_STYLES: Record<RequirementStatus, string> = {
  INTERESTED: "border-slate-200 bg-slate-50 text-slate-700",
  REQUIREMENT_COLLECTED: "border-sky-200 bg-sky-50 text-sky-700",
  QUOTED: "border-violet-200 bg-violet-50 text-violet-700",
  APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  NOT_PROCEEDING: "border-rose-200 bg-rose-50 text-rose-700",
};

export function RequirementStatusBadge({ status }: { status: RequirementStatus }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", REQUIREMENT_STYLES[status])}>{REQUIREMENT_STATUS_LABELS[status]}</span>;
}

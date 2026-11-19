"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { format } from "date-fns";
import { toast } from "sonner";
import { ArrowLeft, GitMerge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { DataPagination } from "@/components/shared/data-pagination";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TableSkeleton } from "@/components/shared/skeletons";
import { PageHeader } from "@/components/shared/page-header";
import { api, fetcher, qs } from "@/lib/http";
import { handleFormError } from "@/lib/form";
import { humanize } from "@/lib/constants";
import type { DuplicateReviewDTO, Paginated } from "@/types/dto";
import { ClientStatusBadge } from "./client-badges";

type Ref = DuplicateReviewDTO["clientA"];
function ClientRef({ c }: { c: Ref }) {
  if (!c) return <span className="text-muted-foreground">Deleted client</span>;
  return (
    <div className="min-w-0 space-y-0.5">
      <Link href={`/clients/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
      <p className="flex items-center gap-2 text-xs text-muted-foreground"><span className="font-mono">{c.clientCode}</span><ClientStatusBadge status={c.status} /></p>
    </div>
  );
}

export function DuplicateReviewsView() {
  const [status, setStatus] = useState("OPEN");
  const [page, setPage] = useState(1);
  const [resolving, setResolving] = useState<DuplicateReviewDTO | null>(null);
  const [decision, setDecision] = useState<"NOT_DUPLICATE" | "CONFIRMED_DUPLICATE">("NOT_DUPLICATE");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { data, error, isLoading, mutate } = useSWR<Paginated<DuplicateReviewDTO>>(`/api/clients/duplicate-reviews${qs({ status, page, pageSize: 20 })}`, fetcher, { keepPreviousData: true });

  async function resolve() {
    if (!resolving) return;
    setBusy(true);
    try {
      await api(`/api/clients/duplicate-reviews/${resolving.id}`, { method: "PATCH", body: { decision, note } });
      toast.success("Decision recorded");
      setResolving(null);
      setNote("");
      mutate();
    } catch (err) {
      handleFormError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Link href="/clients" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Clients</Link>
      <PageHeader title="Duplicate reviews" description="Clients that may be the same company. Nothing is merged automatically; you decide." />
      <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
        <SelectTrigger className="w-full bg-card sm:w-52" aria-label="Filter by decision"><SelectValue /></SelectTrigger>
        <SelectContent>
          {["OPEN", "NOT_DUPLICATE", "CONFIRMED_DUPLICATE", "ALL"].map((s) => <SelectItem key={s} value={s}>{s === "ALL" ? "All" : humanize(s)}</SelectItem>)}
        </SelectContent>
      </Select>

      {error ? <div className="rounded-xl border bg-card"><ErrorState message={error.message} onRetry={() => mutate()} /></div> : isLoading && !data ? <TableSkeleton cols={4} /> : !data?.items.length ? (
        <div className="rounded-xl border border-dashed bg-card"><EmptyState icon={GitMerge} title="Nothing to review" description="Possible duplicates found during creation or import appear here." /></div>
      ) : (
        <>
          <ul className="divide-y rounded-xl border bg-card">
            {data.items.map((r) => (
              <li key={r.id} className="space-y-3 p-4">
                <div className="grid gap-3 sm:grid-cols-2"><ClientRef c={r.clientA} /><ClientRef c={r.clientB} /></div>
                <p className="text-xs text-muted-foreground">{r.reasons.join(" · ") || "Possible duplicate"} · found by {humanize(r.source).toLowerCase()} on {format(new Date(r.createdAt), "d MMM yyyy")}</p>
                {r.status === "OPEN" ? (
                  <Button size="sm" variant="outline" onClick={() => { setResolving(r); setDecision("NOT_DUPLICATE"); setNote(""); }}>Record decision</Button>
                ) : (
                  <p className="text-sm"><span className="font-medium">{humanize(r.status)}</span> by {r.resolvedBy?.name ?? "—"}: {r.resolutionNote}</p>
                )}
              </li>
            ))}
          </ul>
          <DataPagination page={data.page} pageSize={data.pageSize} total={data.total} totalPages={data.totalPages} onPageChange={setPage} label="reviews" />
        </>
      )}

      <Dialog open={!!resolving} onOpenChange={(o) => !busy && !o && setResolving(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record decision</DialogTitle>
            <DialogDescription>{resolving?.clientA?.name} and {resolving?.clientB?.name}. This records your decision only; it does not merge or change either client.</DialogDescription>
          </DialogHeader>
          <Select value={decision} onValueChange={(v) => setDecision(v as typeof decision)}>
            <SelectTrigger aria-label="Decision"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="NOT_DUPLICATE">Not a duplicate</SelectItem>
              <SelectItem value="CONFIRMED_DUPLICATE">Confirmed duplicate</SelectItem>
            </SelectContent>
          </Select>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why? (required)" aria-label="Decision note" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolving(null)} disabled={busy}>Cancel</Button>
            <Button onClick={resolve} disabled={busy || note.trim().length < 3}>{busy ? <Spinner /> : null} Save decision</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

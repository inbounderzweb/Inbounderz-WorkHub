"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Tags } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormRow } from "@/components/shared/form-row";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TableSkeleton } from "@/components/shared/skeletons";
import { DeptChip } from "@/components/tickets/ticket-badges";
import { useTicketCategories, useTicketDepartments } from "@/hooks/use-ticket-options";
import { api, ApiClientError } from "@/lib/http";
import type { TicketCategoryDTO } from "@/types/dto";

const NONE = "__none";

function CategoryDialog({
  category,
  open,
  onOpenChange,
  onSaved,
}: {
  category: TicketCategoryDTO | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dept, setDept] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { data: departments } = useTicketDepartments(open);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on open
      setName(category?.name ?? "");
      setDescription(category?.description ?? "");
      setDept(category?.defaultDepartment?.id ?? "");
      setError(null);
    }
  }, [open, category]);

  async function save() {
    setPending(true);
    setError(null);
    try {
      const body = { name: name.trim(), description: description.trim(), defaultDepartment: dept || null };
      if (category) await api(`/api/ticket-categories/${category.id}`, { method: "PATCH", body });
      else await api("/api/ticket-categories", { method: "POST", body });
      toast.success(category ? "Category updated" : "Category added");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.fieldErrors?.name ?? err.message : "Something went wrong";
      setError(msg);
      toast.error(msg);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{category ? `Edit ${category.name}` : "Add category"}</DialogTitle>
          <DialogDescription>Categories help employees describe their request. Renaming a category doesn&apos;t change existing tickets.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormRow label="Name" htmlFor="cat-name" required error={error ?? undefined}>
            <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Video Request" />
          </FormRow>
          <FormRow label="Description" htmlFor="cat-desc">
            <Input id="cat-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
          </FormRow>
          <FormRow label="Suggested department" htmlFor="cat-dept" description="Pre-selected as the target department when this category is chosen.">
            <Select value={dept || NONE} onValueChange={(v) => setDept(v === NONE ? "" : v)}>
              <SelectTrigger id="cat-dept" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No suggestion</SelectItem>
                {departments?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormRow>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button onClick={save} disabled={pending || name.trim().length < 2}>{pending ? <Spinner /> : null} {category ? "Save" : "Add category"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TicketCategoriesPanel() {
  const { data, error, isLoading, mutate } = useTicketCategories(true);
  const [editing, setEditing] = useState<TicketCategoryDTO | null>(null);
  const [open, setOpen] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  async function toggle(c: TicketCategoryDTO, isActive: boolean) {
    setToggling(c.id);
    try {
      await api(`/api/ticket-categories/${c.id}`, { method: "PATCH", body: { isActive } });
      toast.success(isActive ? `${c.name} enabled` : `${c.name} hidden from new tickets`);
      await mutate();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Couldn't update the category");
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Ticket categories</p>
          <p className="text-xs text-muted-foreground">Shown when employees raise internal tickets. Deactivate instead of deleting so history stays intact.</p>
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus /> Add category</Button>
      </div>
      {error ? (
        <ErrorState message={error.message} onRetry={() => mutate()} />
      ) : isLoading || !data ? (
        <TableSkeleton rows={6} cols={4} />
      ) : !data.length ? (
        <EmptyState icon={Tags} title="No categories" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="pl-4">Category</TableHead>
              <TableHead className="hidden md:table-cell">Suggested department</TableHead>
              <TableHead className="text-right">Tickets</TableHead>
              <TableHead className="text-center">Active</TableHead>
              <TableHead className="w-12 pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((c) => (
              <TableRow key={c.id} className={c.isActive ? undefined : "opacity-60"}>
                <TableCell className="pl-4">
                  <p className="font-medium">{c.name}</p>
                  {c.description ? <p className="max-w-md truncate text-xs text-muted-foreground">{c.description}</p> : null}
                </TableCell>
                <TableCell className="hidden md:table-cell"><DeptChip dept={c.defaultDepartment} /></TableCell>
                <TableCell className="tabular text-right">{c.ticketCount ?? 0}</TableCell>
                <TableCell className="text-center">
                  <Switch checked={c.isActive} disabled={toggling === c.id} onCheckedChange={(v) => toggle(c, v)} aria-label={`${c.name} active`} />
                </TableCell>
                <TableCell className="pr-4">
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.name}`} onClick={() => { setEditing(c); setOpen(true); }}><Pencil /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <CategoryDialog category={editing} open={open} onOpenChange={setOpen} onSaved={() => mutate()} />
    </div>
  );
}

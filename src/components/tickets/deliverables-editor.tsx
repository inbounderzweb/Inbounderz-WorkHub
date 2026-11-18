"use client";

import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DELIVERABLE_LIMIT, DELIVERABLE_TYPES } from "@/lib/constants";

export type DeliverableDraft = { id?: string | null; type: string; quantity: number; specifications?: string };
type Field = "type" | "quantity" | "specifications";

/** One-click starters for the most common requests; any other type can be typed in. */
const QUICK_ADD = ["Video", "Reel", "Photo", "Social Media Post", "Banner", "Poster"];

/**
 * Dynamic list of requested outputs ("2 Videos", "1 Banner"). Used when raising / editing a ticket
 * and by the Project Manager's requirement-change dialog (`completedById` locks finished work).
 */
export function DeliverablesEditor({
  value,
  onChange,
  errorFor,
  rootError,
  completedById,
  disabled,
}: {
  value: DeliverableDraft[];
  onChange: (next: DeliverableDraft[]) => void;
  errorFor?: (index: number, field: Field) => string | undefined;
  rootError?: string;
  /** Existing rows' completed counts: the quantity can't go below them, and such rows can't be removed. */
  completedById?: Record<string, number>;
  disabled?: boolean;
}) {
  const listId = useId();
  const full = value.length >= DELIVERABLE_LIMIT;
  const update = (i: number, patch: Partial<DeliverableDraft>) => onChange(value.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const add = (type = "") => onChange([...value, { type, quantity: 1, specifications: "" }]);

  return (
    <div className="space-y-3">
      <datalist id={listId}>
        {DELIVERABLE_TYPES.map((t) => <option key={t} value={t} />)}
      </datalist>

      {value.length ? (
        <ol className="space-y-2">
          {value.map((d, i) => {
            const done = d.id ? completedById?.[d.id] ?? 0 : 0;
            const typeErr = errorFor?.(i, "type");
            const qtyErr = errorFor?.(i, "quantity");
            const specErr = errorFor?.(i, "specifications");
            return (
              <li key={d.id ?? `new-${i}`} className="space-y-2 rounded-lg border bg-muted/20 p-3">
                <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_auto] items-start gap-2">
                  <div className="space-y-1">
                    <label htmlFor={`${listId}-type-${i}`} className="text-xs font-medium text-muted-foreground">Type</label>
                    <Input
                      id={`${listId}-type-${i}`}
                      list={listId}
                      value={d.type}
                      onChange={(e) => update(i, { type: e.target.value })}
                      placeholder="e.g. Video, Banner"
                      maxLength={60}
                      disabled={disabled}
                      aria-invalid={!!typeErr}
                      autoComplete="off"
                    />
                    {typeErr ? <p className="text-xs text-destructive">{typeErr}</p> : null}
                  </div>
                  <div className="space-y-1">
                    <label htmlFor={`${listId}-qty-${i}`} className="text-xs font-medium text-muted-foreground">Quantity</label>
                    <Input
                      id={`${listId}-qty-${i}`}
                      type="number"
                      inputMode="numeric"
                      min={Math.max(1, done)}
                      step={1}
                      value={d.quantity || ""}
                      onChange={(e) => update(i, { quantity: e.target.value === "" ? 0 : Number(e.target.value) })}
                      disabled={disabled}
                      aria-invalid={!!qtyErr}
                    />
                    {qtyErr ? <p className="text-xs text-destructive">{qtyErr}</p> : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="mt-6 text-muted-foreground hover:text-destructive"
                    onClick={() => onChange(value.filter((_, j) => j !== i))}
                    disabled={disabled || done > 0}
                    aria-label={`Remove ${d.type || "deliverable"}`}
                    title={done > 0 ? `${done} already completed, so it can't be removed` : "Remove"}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <Textarea
                  rows={2}
                  value={d.specifications ?? ""}
                  onChange={(e) => update(i, { specifications: e.target.value })}
                  placeholder="Specifications (optional): size, format, duration, platform, copy…"
                  maxLength={2000}
                  disabled={disabled}
                  aria-label={`Specifications for ${d.type || "this deliverable"}`}
                  aria-invalid={!!specErr}
                />
                {specErr ? <p className="text-xs text-destructive">{specErr}</p> : null}
                {done > 0 ? <p className="text-xs text-muted-foreground">{done} already completed</p> : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          No deliverables yet. List the outputs you need, e.g. 2 Videos and 1 Banner.
        </p>
      )}

      {rootError ? <p className="text-sm text-destructive">{rootError}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => add()} disabled={disabled || full}>
          <Plus /> Add deliverable
        </Button>
        {QUICK_ADD.map((t) => (
          <Button key={t} type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => add(t)} disabled={disabled || full}>
            + {t}
          </Button>
        ))}
        {full ? <span className="text-xs text-muted-foreground">Up to {DELIVERABLE_LIMIT} deliverables</span> : null}
      </div>
    </div>
  );
}

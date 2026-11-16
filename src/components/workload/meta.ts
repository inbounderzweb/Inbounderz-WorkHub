import type { WorkloadCategory } from "@/types/dto";

/** One status palette everywhere: grey none, green low, blue moderate, amber high, red overloaded. */
export const CATEGORY_ORDER: WorkloadCategory[] = ["NONE", "LOW", "MODERATE", "HIGH", "OVERLOADED"];

export const CATEGORY: Record<WorkloadCategory, { label: string; card: string; color: string; chip: string; bar: string }> = {
  NONE: { label: "No active tasks", card: "No Active Tasks", color: "#94a3b8", chip: "border-slate-200 bg-slate-50 text-slate-600", bar: "bg-slate-400" },
  LOW: { label: "Low workload", card: "Available Capacity", color: "#22c55e", chip: "border-emerald-200 bg-emerald-50 text-emerald-700", bar: "bg-emerald-500" },
  MODERATE: { label: "Moderate workload", card: "Moderately Occupied", color: "#3b82f6", chip: "border-blue-200 bg-blue-50 text-blue-700", bar: "bg-blue-500" },
  HIGH: { label: "High workload", card: "Fully Occupied", color: "#f59e0b", chip: "border-amber-200 bg-amber-50 text-amber-700", bar: "bg-amber-500" },
  OVERLOADED: { label: "Overloaded", card: "Overloaded", color: "#ef4444", chip: "border-red-200 bg-red-50 text-red-700", bar: "bg-red-500" },
};

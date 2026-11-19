import type { Currency } from "./constants";

/** Amounts are always shown with their own currency; different currencies are never added together. */
export function formatMoney(amount: number | null | undefined, currency: Currency | string = "INR"): string {
  if (amount === null || amount === undefined) return "—";
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

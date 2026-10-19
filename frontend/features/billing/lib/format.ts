import type { BillingInterval, PlanPrice } from "../types";

/** Decimal places Stripe's minor unit has for the currency (2 for USD, 0 for JPY). */
function minorUnitDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** "$15", "$12.50", "¥1,500": whole amounts drop the decimals. */
export function formatMoney(amountMinor: number, currency: string, locale = "en"): string {
  const digits = minorUnitDigits(currency);
  const major = amountMinor / 10 ** digits;
  const whole = Number.isInteger(major);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : digits,
      maximumFractionDigits: digits,
    }).format(major);
  } catch {
    return `${major} ${currency.toUpperCase()}`;
  }
}

/** What one month costs on a price: the yearly price spread over twelve months. */
export function perMonth(price: PlanPrice, interval: BillingInterval): PlanPrice {
  return interval === "yearly" ? { ...price, amount: Math.round(price.amount / 12) } : price;
}

/** Whole-number percentage the yearly price saves against twelve monthly ones, or null when it saves nothing. */
export function yearlySavingsPercent(monthly: PlanPrice | null, yearly: PlanPrice | null): number | null {
  if (!monthly || !yearly || monthly.currency !== yearly.currency || monthly.amount <= 0) return null;
  const percent = Math.round((1 - yearly.amount / (monthly.amount * 12)) * 100);
  return percent > 0 ? percent : null;
}

/** null = unlimited. */
export function formatLimit(value: number | null, unlimited = "Unlimited"): string {
  return value === null ? unlimited : value.toLocaleString("en");
}

/** Share of a limit used, 0 to 100; unlimited and zero limits read as 0 / 100. */
export function usagePercent(used: number, limit: number | null): number {
  if (limit === null) return 0;
  if (limit <= 0) return used > 0 ? 100 : 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

/** "Nov 19, 2026" in UTC, so the date does not depend on the viewer's time zone. */
export function formatDate(value: string | Date, locale = "en"): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

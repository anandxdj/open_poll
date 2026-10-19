import apiClient from "@/lib/api-client";
import type { BillingOverview, CheckoutRequest, PlanCatalog } from "../types";

type Envelope<T> = { data: T };

/** Public: the plan catalogue with prices when billing is configured. */
export async function getPlanCatalog() {
  const res = await apiClient.get<Envelope<PlanCatalog>>("/plans");
  return res.data.data;
}

/** The current workspace's billing (owner only). */
export async function getBilling() {
  const res = await apiClient.get<Envelope<BillingOverview>>("/billing");
  return res.data.data;
}

/** Stripe Checkout URL for the current workspace; 503 BILLING_DISABLED when billing is off. */
export async function startCheckout(request: CheckoutRequest) {
  const res = await apiClient.post<Envelope<{ url: string }>>("/billing/checkout", request);
  return res.data.data.url;
}

/** Stripe Billing Portal URL for the current workspace. */
export async function openBillingPortal() {
  const res = await apiClient.post<Envelope<{ url: string }>>("/billing/portal");
  return res.data.data.url;
}

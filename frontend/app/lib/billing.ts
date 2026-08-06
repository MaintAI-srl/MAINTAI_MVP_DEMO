/**
 * Client del livello commerciale: piani, abbonamento, consumo, checkout.
 *
 * Il frontend qui *mostra* lo stato e guida l'utente. Non decide: ogni limite e
 * ogni blocco è deciso dal backend, che risponde 402 con un `detail`
 * strutturato. Questo modulo si limita a rendere quel detail leggibile.
 */

import { ApiError, apiGet, apiPost, apiPut } from "./api";

export type PlanCode = string;

export type Plan = {
  code: PlanCode;
  name: string;
  description: string;
  price_monthly: number;   // centesimi
  price_yearly: number;
  currency: string;
  included_users: number;
  included_sites: number;
  included_assets: number;
  included_ai_calls: number;
  storage_mb: number;
  support_level: string;
  trial_days: number;
  is_self_serve: boolean;
  highlight: string | null;
  features: string[];
  modules: string[] | null;
};

export type Addon = {
  code: string;
  name: string;
  description: string;
  price_monthly: number;
  currency: string;
  metric: string;
  grants: number;
};

export type PlansResponse = {
  plans: Plan[];
  addons: Addon[];
  provider: "local" | "stripe";
  trial_days: number;
};

export type SubscriptionStatus =
  | "trialing" | "active" | "past_due" | "unpaid"
  | "paused" | "cancelled" | "incomplete" | "incomplete_expired";

export type Subscription = {
  plan_code: PlanCode;
  plan_name: string;
  status: SubscriptionStatus;
  provider: string;
  billing_interval: "monthly" | "yearly";
  currency: string;
  extra_users: number;
  extra_sites: number;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  grace_period_ends_at: string | null;
  price_monthly: number | null;
  price_yearly: number | null;
};

export type Entitlements = {
  tenant_id: number | null;
  plan_code: string;
  plan_name: string;
  status: string;
  access_level: "full" | "read_only";
  reason: string | null;
  limits: Record<string, number>;
  trial_ends_at: string | null;
  current_period_end: string | null;
  grace_period_ends_at: string | null;
  cancel_at_period_end: boolean;
  /** Tenant senza abbonamento: nessun limite commerciale applicato. */
  grandfathered: boolean;
  warnings: string[];
};

export type SubscriptionResponse = {
  subscription: Subscription | null;
  entitlements: Entitlements;
  provider: "local" | "stripe";
};

export type UsageMetric = {
  metric: string;
  label: string;
  used: number;
  limit: number | null;
  unlimited: boolean;
  percent: number | null;
  addons: string[];
};

export type UsageResponse = {
  entitlements: Entitlements;
  metrics: UsageMetric[];
};

export type CheckoutResponse = {
  url: string;
  session_id: string;
  provider: string;
  simulated: boolean;
};

/** Corpo di un 402 «quota del piano esaurita». */
export type PlanLimitDetail = {
  error: "plan_limit_reached";
  metric: string;
  metric_label: string;
  current: number;
  limit: number;
  plan_code: string;
  upgrade_url: string;
  message: string;
};

/** Corpo di un 402 «abbonamento non in regola». */
export type SubscriptionInactiveDetail = {
  error: "subscription_inactive";
  reason: string;
  subscription_status: string;
  upgrade_url: string;
  message: string;
};

export type BillingBlock = PlanLimitDetail | SubscriptionInactiveDetail;

/**
 * Riconosce un blocco commerciale in un errore API.
 *
 * Va usato nei `catch` delle azioni che creano risorse: permette di mostrare
 * «3 utenti su 3, passa a Professional» invece di un generico errore, e
 * soprattutto di **non chiudere il form** che l'utente ha appena compilato.
 */
export function asBillingBlock(error: unknown): BillingBlock | null {
  if (!(error instanceof ApiError) || error.status !== 402) return null;
  const detail = error.detail as { error?: string } | undefined;
  if (detail?.error === "plan_limit_reached" || detail?.error === "subscription_inactive") {
    return detail as BillingBlock;
  }
  return null;
}

export function formatPrice(cents: number, currency = "EUR", locale = "it-IT"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.ceil(diff / 86_400_000);
}

// ── Chiamate ─────────────────────────────────────────────────────────────────

export const getPlans = () => apiGet<PlansResponse>("/billing/plans");
export const getSubscription = () => apiGet<SubscriptionResponse>("/billing/subscription");
export const getUsage = () => apiGet<UsageResponse>("/billing/usage");

export const createCheckout = (plan_code: string, billing_interval: "monthly" | "yearly" = "monthly") =>
  apiPost<CheckoutResponse>("/billing/checkout-session", { plan_code, billing_interval });

export const openCustomerPortal = () =>
  apiPost<{ url: string; provider: string; simulated: boolean }>("/billing/customer-portal");

export const confirmSimulatedCheckout = (token: string) =>
  apiPost<{ status: string; detail: string; event_id: string }>("/billing/simulate-checkout", { token });

export const changePlan = (plan_code: string, billing_interval?: "monthly" | "yearly") =>
  apiPost<{ subscription: Subscription }>("/billing/change-plan", { plan_code, billing_interval });

export const changeQuantities = (extra_users?: number, extra_sites?: number) =>
  apiPost<{ subscription: Subscription }>("/billing/change-quantities", { extra_users, extra_sites });

export const cancelSubscription = (at_period_end: boolean, reason?: string) =>
  apiPost<{ subscription: Subscription }>("/billing/cancel", { at_period_end, reason });

export const reactivateSubscription = () =>
  apiPost<{ subscription: Subscription }>("/billing/reactivate");

export type CompanyProfile = {
  nome: string;
  slug: string;
  legal_name: string | null;
  vat_number: string | null;
  billing_email: string | null;
  country: string | null;
  onboarding_status: string | null;
};

export const getCompany = () => apiGet<CompanyProfile>("/billing/company");
export const updateCompany = (data: Partial<CompanyProfile>) => apiPut<{ ok: boolean }>("/billing/company", data);

// ── Registrazione pubblica ───────────────────────────────────────────────────

export type SignupStatus = {
  enabled: boolean;
  trial_days: number;
  terms_version: string;
  privacy_version: string;
};

export type SignupPayload = {
  email: string;
  password: string;
  nome_referente: string;
  azienda: string;
  paese: string;
  vat_number?: string;
  plan_code?: string;
  accetta_termini: boolean;
  accetta_privacy: boolean;
};

export type SignupResponse = {
  message: string;
  trial_days: number;
  tenant_slug: string | null;
  /** Presente solo fuori produzione: consente di provare senza SMTP. */
  dev_verification_token?: string;
  dev_verification_url?: string;
};

export const getSignupStatus = () => apiGet<SignupStatus>("/public/signup-status");
export const signup = (payload: SignupPayload) => apiPost<SignupResponse>("/public/signup", payload);
export const verifyEmail = (token: string) =>
  apiPost<{ ok: boolean; message: string; username: string }>("/public/verify-email", { token });
export const forgotPassword = (email: string) =>
  apiPost<{ ok: boolean; message: string; dev_reset_url?: string }>("/public/forgot-password", { email });
export const resetPassword = (token: string, new_password: string) =>
  apiPost<{ ok: boolean; message: string }>("/public/reset-password", { token, new_password });

// ── Etichette leggibili ──────────────────────────────────────────────────────

export const STATUS_LABELS: Record<string, string> = {
  trialing: "In prova",
  active: "Attivo",
  past_due: "Pagamento in sospeso",
  unpaid: "Non pagato",
  paused: "Sospeso",
  cancelled: "Disdetto",
  incomplete: "Da completare",
  incomplete_expired: "Scaduto",
  unmanaged: "Senza abbonamento",
};

export const STATUS_COLORS: Record<string, string> = {
  trialing: "#3b82f6",
  active: "#22c55e",
  past_due: "#f59e0b",
  unpaid: "#ef4444",
  paused: "#94a3b8",
  cancelled: "#ef4444",
  incomplete: "#f59e0b",
  incomplete_expired: "#ef4444",
  unmanaged: "#94a3b8",
};

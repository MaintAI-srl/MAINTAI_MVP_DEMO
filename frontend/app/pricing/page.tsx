"use client";

/**
 * Pagina prezzi pubblica.
 *
 * Il listino arriva dal backend (`GET /billing/plans`), non è duplicato qui: un
 * prezzo scritto due volte è un prezzo che prima o poi diverge, e il posto in
 * cui diverge è sempre quello che il cliente vede prima di pagare.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PublicShell from "../components/PublicShell";
import { formatPrice, getPlans, getSignupStatus, type Plan, type PlansResponse } from "../lib/billing";
import { useT } from "@/app/lib/i18n";

export default function PricingPage() {
  const tr = useT();
  const [data, setData] = useState<PlansResponse | null>(null);
  const [signupOpen, setSignupOpen] = useState(false);
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([getPlans(), getSignupStatus().catch(() => null)])
      .then(([plans, status]) => {
        setData(plans);
        setSignupOpen(Boolean(status?.enabled));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Errore di caricamento"));
  }, []);

  useEffect(load, [load]);

  return (
    <PublicShell
      title={tr("Piani e prezzi")}
      subtitle={tr("Manutenzione industriale assistita dall'AI. Nessun costo di attivazione, disdetta in autonomia.")}
      maxWidth={1080}
      footer={
        <span>
          {tr("Hai già un account?")} <Link href="/login" style={{ color: "#3b82f6" }}>{tr("Accedi")}</Link>
        </span>
      }
    >
      {error && <p style={{ color: "#ef4444" }}>{error}</p>}
      {!data && !error && <p style={{ color: "var(--text-muted)" }}>{tr("Caricamento…")}</p>}

      {data && (
        <>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 28 }}>
            {(["monthly", "yearly"] as const).map((value) => (
              <button
                key={value}
                onClick={() => setInterval(value)}
                style={{
                  padding: "8px 18px",
                  borderRadius: 999,
                  border: `1px solid ${interval === value ? "#3b82f6" : "var(--border-default)"}`,
                  background: interval === value ? "rgba(59,130,246,0.12)" : "transparent",
                  color: interval === value ? "#3b82f6" : "var(--text-secondary)",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                {value === "monthly" ? tr("Mensile") : tr("Annuale (2 mesi in omaggio)")}
              </button>
            ))}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 18,
              alignItems: "stretch",
            }}
          >
            {data.plans.map((plan) => (
              <PlanCard key={plan.code} plan={plan} interval={interval} signupOpen={signupOpen} />
            ))}
          </div>

          {data.addons.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>{tr("Aggiungi quando serve")}</h2>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {data.addons.map((addon) => (
                  <div
                    key={addon.code}
                    style={{
                      flex: "1 1 240px",
                      padding: 14,
                      border: "1px solid var(--border-default)",
                      borderRadius: 12,
                      background: "var(--bg-base)",
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>{addon.name}</div>
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>{addon.description}</div>
                    <div style={{ fontWeight: 800, color: "#3b82f6" }}>
                      {formatPrice(addon.price_monthly)} <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>/{tr("mese")}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p style={{ marginTop: 26, fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
            {tr("Prezzi IVA esclusa. La prova gratuita dura {days} giorni e non richiede carta di credito.", { days: data.trial_days })}
            {data.provider === "local" && ` — ${tr("Ambiente dimostrativo: il pagamento è simulato.")}`}
          </p>
        </>
      )}
    </PublicShell>
  );
}

function PlanCard({ plan, interval, signupOpen }: { plan: Plan; interval: "monthly" | "yearly"; signupOpen: boolean }) {
  const tr = useT();
  const price = interval === "monthly" ? plan.price_monthly : plan.price_yearly;
  const evidenziato = Boolean(plan.highlight);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: 22,
        borderRadius: 16,
        border: `1px solid ${evidenziato ? "#3b82f6" : "var(--border-default)"}`,
        background: evidenziato ? "rgba(59,130,246,0.06)" : "var(--bg-base)",
        position: "relative",
      }}
    >
      {plan.highlight && (
        <span
          style={{
            position: "absolute", top: -11, left: 20,
            background: "#3b82f6", color: "white", fontSize: 11, fontWeight: 800,
            padding: "3px 10px", borderRadius: 999,
          }}
        >
          {tr(plan.highlight)}
        </span>
      )}

      <h3 style={{ fontSize: 20, fontWeight: 800, margin: "4px 0 6px 0" }}>{plan.name}</h3>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 16px 0", minHeight: 38 }}>{plan.description}</p>

      <div style={{ marginBottom: 16 }}>
        {plan.is_self_serve ? (
          <>
            <span style={{ fontSize: 30, fontWeight: 800 }}>{formatPrice(price)}</span>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {interval === "monthly" ? ` /${tr("mese")}` : ` /${tr("anno")}`}
            </span>
          </>
        ) : (
          <span style={{ fontSize: 24, fontWeight: 800 }}>{tr("Su misura")}</span>
        )}
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 20px 0", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        {plan.features.map((feature) => (
          <li key={feature} style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "flex-start" }}>
            <span style={{ color: "#22c55e", fontWeight: 800 }}>✓</span>
            <span style={{ color: "var(--text-secondary)" }}>{tr(feature)}</span>
          </li>
        ))}
      </ul>

      {plan.is_self_serve ? (
        <Link
          href={signupOpen ? `/register?plan=${plan.code}` : "/login"}
          style={{
            display: "block", textAlign: "center", padding: "12px",
            borderRadius: 12, textDecoration: "none", fontWeight: 800, fontSize: 14,
            background: evidenziato ? "linear-gradient(135deg,#3b82f6,#2563eb)" : "transparent",
            color: evidenziato ? "white" : "#3b82f6",
            border: evidenziato ? "none" : "1px solid #3b82f6",
          }}
        >
          {signupOpen ? tr("Inizia la prova gratuita") : tr("Accedi")}
        </Link>
      ) : (
        <a
          href="mailto:commerciale@maintai.it?subject=Richiesta%20piano%20Enterprise"
          style={{
            display: "block", textAlign: "center", padding: "12px",
            borderRadius: 12, textDecoration: "none", fontWeight: 800, fontSize: 14,
            color: "#3b82f6", border: "1px solid #3b82f6",
          }}
        >
          {tr("Parla con noi")}
        </a>
      )}
    </div>
  );
}

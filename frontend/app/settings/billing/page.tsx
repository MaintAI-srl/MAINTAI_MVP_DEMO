"use client";

/**
 * Area amministratore cliente — Abbonamento.
 *
 * Deve permettere di fare da soli tutto ciò che oggi richiede una email al
 * fornitore: vedere piano e consumo, cambiare piano, comprare licenze,
 * aggiornare i dati di fatturazione, disdire e riattivare.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth";
import {
  STATUS_COLORS,
  STATUS_LABELS,
  cancelSubscription,
  changePlan,
  changeQuantities,
  createCheckout,
  daysUntil,
  formatPrice,
  getCompany,
  getPlans,
  getSubscription,
  getUsage,
  openCustomerPortal,
  reactivateSubscription,
  updateCompany,
  type CompanyProfile,
  type PlansResponse,
  type SubscriptionResponse,
  type UsageResponse,
} from "../../lib/billing";
import { notify } from "@/lib/toast";
import { useT } from "@/app/lib/i18n";

export default function BillingSettingsPage() {
  const tr = useT();
  const { user } = useAuth();
  const puoGestire = user?.ruolo === "responsabile" || user?.ruolo === "superadmin";

  const [plans, setPlans] = useState<PlansResponse | null>(null);
  const [sub, setSub] = useState<SubscriptionResponse | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const carica = useCallback(async () => {
    try {
      const [p, s, u] = await Promise.all([getPlans(), getSubscription(), getUsage()]);
      setPlans(p);
      setSub(s);
      setUsage(u);
      if (puoGestire) setCompany(await getCompany().catch(() => null));
      setErrore(null);
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Errore di caricamento");
    }
  }, [puoGestire]);

  useEffect(() => { carica(); }, [carica]);

  const azione = async (fn: () => Promise<unknown>, successo: string) => {
    setBusy(true);
    try {
      await fn();
      notify.success(successo);
      await carica();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : tr("Operazione non riuscita"));
    } finally {
      setBusy(false);
    }
  };

  const vaiAlCheckout = async (planCode: string, intervallo: "monthly" | "yearly") => {
    setBusy(true);
    try {
      const { url } = await createCheckout(planCode, intervallo);
      window.location.href = url;
    } catch (e) {
      notify.error(e instanceof Error ? e.message : tr("Checkout non disponibile"));
      setBusy(false);
    }
  };

  if (errore) return <p style={{ color: "#ef4444", padding: 24 }}>{errore}</p>;
  if (!sub || !plans || !usage) return <p style={{ padding: 24, color: "var(--text-muted)" }}>{tr("Caricamento…")}</p>;

  const ent = sub.entitlements;
  const abbonamento = sub.subscription;
  const giorniTrial = daysUntil(ent.trial_ends_at);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1000 }}>
      {/* ── Stato ─────────────────────────────────────────────────────────── */}
      <Card>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", fontWeight: 700 }}>
              {tr("Piano attivo")}
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, margin: "4px 0 8px 0" }}>{ent.plan_name}</div>
            <Badge colore={STATUS_COLORS[ent.status] ?? "#94a3b8"}>
              {tr(STATUS_LABELS[ent.status] ?? ent.status)}
            </Badge>
            {ent.access_level === "read_only" && (
              <Badge colore="#ef4444" style={{ marginLeft: 8 }}>{tr("Sola lettura")}</Badge>
            )}
          </div>

          <div style={{ textAlign: "right" }}>
            {abbonamento?.price_monthly ? (
              <div style={{ fontSize: 22, fontWeight: 800 }}>
                {formatPrice(abbonamento.billing_interval === "yearly" ? abbonamento.price_yearly ?? 0 : abbonamento.price_monthly)}
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-muted)" }}>
                  {abbonamento.billing_interval === "yearly" ? ` /${tr("anno")}` : ` /${tr("mese")}`}
                </span>
              </div>
            ) : null}
            {ent.trial_ends_at && giorniTrial !== null && (
              <div style={{ fontSize: 13, color: giorniTrial <= 3 ? "#f59e0b" : "var(--text-secondary)", marginTop: 6 }}>
                {giorniTrial >= 0
                  ? tr("Prova gratuita: {days} giorni rimanenti", { days: giorniTrial })
                  : tr("Prova gratuita terminata")}
              </div>
            )}
            {ent.current_period_end && !ent.trial_ends_at && (
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6 }}>
                {ent.cancel_at_period_end
                  ? tr("Accesso fino al {date}", { date: new Date(ent.current_period_end).toLocaleDateString("it-IT") })
                  : tr("Rinnovo il {date}", { date: new Date(ent.current_period_end).toLocaleDateString("it-IT") })}
              </div>
            )}
          </div>
        </div>

        {ent.grandfathered && (
          <Nota tipo="info">
            {tr("Questo cliente non ha un abbonamento associato: nessun limite di piano viene applicato. È il comportamento previsto per gli account creati dall'amministratore.")}
          </Nota>
        )}
        {ent.warnings.map((w) => <Nota key={w} tipo="warn">{w}</Nota>)}

        {puoGestire && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
            {sub.provider === "stripe" && (
              <BottoneSecondario disabled={busy} onClick={() => azione(async () => {
                const { url } = await openCustomerPortal();
                window.location.href = url;
              }, tr("Apertura portale…"))}>
                {tr("Metodo di pagamento e fatture")}
              </BottoneSecondario>
            )}
            {abbonamento && !abbonamento.cancel_at_period_end && abbonamento.status !== "cancelled" && (
              <BottoneSecondario
                disabled={busy}
                pericolo
                onClick={() => {
                  const motivo = window.prompt(tr("Vuoi dirci perché? (facoltativo)")) ?? undefined;
                  if (!window.confirm(tr("Confermi la disdetta? L'accesso resterà attivo fino alla fine del periodo già pagato."))) return;
                  azione(() => cancelSubscription(true, motivo), tr("Disdetta registrata."));
                }}
              >
                {tr("Disdici")}
              </BottoneSecondario>
            )}
            {abbonamento && (abbonamento.cancel_at_period_end || abbonamento.status === "cancelled") && (
              <BottoneSecondario disabled={busy} onClick={() => azione(reactivateSubscription, tr("Abbonamento riattivato."))}>
                {tr("Riattiva")}
              </BottoneSecondario>
            )}
          </div>
        )}
      </Card>

      {/* ── Consumo ───────────────────────────────────────────────────────── */}
      <Card titolo={tr("Utilizzo")}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          {usage.metrics.map((m) => (
            <div key={m.metric} style={{ padding: 14, borderRadius: 12, background: "var(--bg-base)", border: "1px solid var(--border-default)" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {tr(m.label)}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, margin: "6px 0" }}>
                {m.used}
                <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-muted)" }}>
                  {m.unlimited ? ` / ${tr("illimitati")}` : ` / ${m.limit}`}
                </span>
              </div>
              {!m.unlimited && (
                <div style={{ height: 6, borderRadius: 999, background: "var(--border-default)", overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${Math.min(100, m.percent ?? 0)}%`,
                      height: "100%",
                      background: (m.percent ?? 0) >= 100 ? "#ef4444" : (m.percent ?? 0) >= 80 ? "#f59e0b" : "#22c55e",
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {puoGestire && abbonamento && abbonamento.provider === "local" && !ent.grandfathered && (
          <LicenzeExtra
            busy={busy}
            extraUsers={abbonamento.extra_users}
            extraSites={abbonamento.extra_sites}
            onSalva={(u, s) => azione(() => changeQuantities(u, s), tr("Licenze aggiornate."))}
          />
        )}
      </Card>

      {/* ── Cambio piano ──────────────────────────────────────────────────── */}
      {puoGestire && (
        <Card titolo={tr("Piani disponibili")}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
            {plans.plans.filter((p) => p.is_self_serve).map((plan) => {
              const attuale = plan.code === ent.plan_code;
              return (
                <div
                  key={plan.code}
                  style={{
                    padding: 16, borderRadius: 12,
                    border: `1px solid ${attuale ? "#22c55e" : "var(--border-default)"}`,
                    background: "var(--bg-base)",
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 17 }}>{plan.name}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, margin: "8px 0" }}>
                    {formatPrice(plan.price_monthly)}
                    <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}> /{tr("mese")}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
                    {tr("{u} utenti · {s} siti · {a} asset", { u: plan.included_users, s: plan.included_sites, a: plan.included_assets })}
                  </div>
                  {attuale ? (
                    <Badge colore="#22c55e">{tr("Piano attuale")}</Badge>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() => {
                        // Con abbonamento locale già attivo il cambio è diretto;
                        // altrimenti si passa dal checkout, che è l'unico punto
                        // in cui nasce un pagamento.
                        if (abbonamento?.status === "active" && abbonamento.provider === "local") {
                          azione(() => changePlan(plan.code), tr("Piano aggiornato."));
                        } else {
                          vaiAlCheckout(plan.code, "monthly");
                        }
                      }}
                      style={{
                        width: "100%", padding: "10px", borderRadius: 10, border: "none",
                        background: "linear-gradient(135deg,#3b82f6,#2563eb)", color: "white",
                        fontWeight: 800, fontSize: 13, cursor: busy ? "not-allowed" : "pointer",
                      }}
                    >
                      {tr("Passa a {plan}", { plan: plan.name })}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 14 }}>
            {plans.provider === "local"
              ? tr("Provider di pagamento in modalità dimostrativa: il checkout è simulato e non addebita nulla.")
              : tr("I pagamenti sono gestiti dal provider: MaintAI non tratta né conserva dati di carta.")}
            {" "}
            <Link href="/pricing" style={{ color: "#3b82f6" }}>{tr("Confronta i piani")}</Link>
          </p>
        </Card>
      )}

      {/* ── Dati di fatturazione ──────────────────────────────────────────── */}
      {puoGestire && company && (
        <DatiAzienda company={company} busy={busy} onSalva={(dati) => azione(() => updateCompany(dati), tr("Dati aggiornati."))} />
      )}
    </div>
  );
}

// ── Componenti locali ────────────────────────────────────────────────────────

function Card({ titolo, children }: { titolo?: string; children: React.ReactNode }) {
  return (
    <section style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)", borderRadius: 16, padding: 20 }}>
      {titolo && <h2 style={{ fontSize: 15, fontWeight: 800, margin: "0 0 16px 0", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-secondary)" }}>{titolo}</h2>}
      {children}
    </section>
  );
}

function Badge({ colore, children, style }: { colore: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 800,
      background: `${colore}1f`, color: colore, border: `1px solid ${colore}55`, ...style,
    }}>
      {children}
    </span>
  );
}

function Nota({ tipo, children }: { tipo: "info" | "warn"; children: React.ReactNode }) {
  const colore = tipo === "warn" ? "#f59e0b" : "#3b82f6";
  return (
    <div style={{
      marginTop: 14, padding: "10px 14px", borderRadius: 10, fontSize: 13,
      background: `${colore}14`, border: `1px solid ${colore}44`, color: colore,
    }}>
      {children}
    </div>
  );
}

function BottoneSecondario({
  children, onClick, disabled, pericolo,
}: { children: React.ReactNode; onClick: () => void; disabled?: boolean; pericolo?: boolean }) {
  const colore = pericolo ? "#ef4444" : "#3b82f6";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "10px 16px", borderRadius: 10, fontWeight: 700, fontSize: 13,
        background: "transparent", color: colore, border: `1px solid ${colore}`,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

function LicenzeExtra({
  busy, extraUsers, extraSites, onSalva,
}: { busy: boolean; extraUsers: number; extraSites: number; onSalva: (u: number, s: number) => void }) {
  const tr = useT();
  const [u, setU] = useState(extraUsers);
  const [s, setS] = useState(extraSites);

  return (
    <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border-default)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{tr("Licenze aggiuntive")}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>
        <CampoNumero etichetta={tr("Utenti extra")} valore={u} onChange={setU} />
        <CampoNumero etichetta={tr("Siti extra")} valore={s} onChange={setS} />
        <button
          disabled={busy || (u === extraUsers && s === extraSites)}
          onClick={() => onSalva(u, s)}
          style={{
            padding: "10px 16px", borderRadius: 10, border: "none", fontWeight: 800, fontSize: 13,
            background: "linear-gradient(135deg,#3b82f6,#2563eb)", color: "white",
            cursor: busy ? "not-allowed" : "pointer",
            opacity: u === extraUsers && s === extraSites ? 0.5 : 1,
          }}
        >
          {tr("Aggiorna licenze")}
        </button>
      </div>
      <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10 }}>
        {tr("Le licenze non possono scendere sotto il numero già in uso: disattiva prima gli utenti o elimina i siti.")}
      </p>
    </div>
  );
}

function CampoNumero({ etichetta, valore, onChange }: { etichetta: string; valore: number; onChange: (v: number) => void }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>{etichetta}</span>
      <input
        type="number" min={0} value={valore}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
        style={{
          width: 110, padding: "8px 12px", borderRadius: 10,
          background: "var(--bg-base)", border: "1px solid var(--border-default)",
          color: "var(--text-primary)", fontSize: 14,
        }}
      />
    </label>
  );
}

function DatiAzienda({
  company, busy, onSalva,
}: { company: CompanyProfile; busy: boolean; onSalva: (dati: Partial<CompanyProfile>) => void }) {
  const tr = useT();
  const [form, setForm] = useState({
    nome: company.nome ?? "",
    legal_name: company.legal_name ?? "",
    vat_number: company.vat_number ?? "",
    billing_email: company.billing_email ?? "",
    country: company.country ?? "IT",
  });

  const set = (campo: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [campo]: e.target.value }));

  const stile: React.CSSProperties = {
    width: "100%", padding: "10px 12px", borderRadius: 10,
    background: "var(--bg-base)", border: "1px solid var(--border-default)",
    color: "var(--text-primary)", fontSize: 14, boxSizing: "border-box",
  };

  return (
    <Card titolo={tr("Dati di fatturazione")}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        <Campo etichetta={tr("Nome visualizzato")}><input value={form.nome} onChange={set("nome")} style={stile} /></Campo>
        <Campo etichetta={tr("Ragione sociale")}><input value={form.legal_name} onChange={set("legal_name")} style={stile} /></Campo>
        <Campo etichetta={tr("Partita IVA")}><input value={form.vat_number} onChange={set("vat_number")} style={stile} /></Campo>
        <Campo etichetta={tr("Email di fatturazione")}><input type="email" value={form.billing_email} onChange={set("billing_email")} style={stile} /></Campo>
        <Campo etichetta={tr("Paese")}>
          <input maxLength={2} value={form.country} onChange={(e) => setForm((p) => ({ ...p, country: e.target.value.toUpperCase() }))} style={stile} />
        </Campo>
      </div>
      <button
        disabled={busy}
        onClick={() => onSalva(form)}
        style={{
          marginTop: 16, padding: "10px 18px", borderRadius: 10, border: "none",
          background: "linear-gradient(135deg,#3b82f6,#2563eb)", color: "white",
          fontWeight: 800, fontSize: 13, cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        {tr("Salva")}
      </button>
    </Card>
  );
}

function Campo({ etichetta, children }: { etichetta: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{etichetta}</span>
      {children}
    </label>
  );
}

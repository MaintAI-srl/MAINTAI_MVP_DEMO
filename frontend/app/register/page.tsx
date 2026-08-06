"use client";

/**
 * Registrazione pubblica: azienda + amministratore + prova gratuita.
 *
 * Un solo passaggio. Spezzare la registrazione in "prima l'account, poi
 * l'azienda" raddoppia i punti di abbandono senza raccogliere un dato in più.
 */

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import PublicShell, { primaryButtonStyle, publicInputStyle, publicLabelStyle } from "../components/PublicShell";
import { getSignupStatus, signup, type SignupResponse } from "../lib/billing";
import { notify } from "@/lib/toast";
import { useT } from "@/app/lib/i18n";

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const tr = useT();
  const params = useSearchParams();
  const planFromUrl = params.get("plan") ?? undefined;

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [trialDays, setTrialDays] = useState(14);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<SignupResponse | null>(null);

  const [form, setForm] = useState({
    azienda: "",
    nome_referente: "",
    email: "",
    password: "",
    vat_number: "",
    paese: "IT",
  });
  const [consensi, setConsensi] = useState({ termini: false, privacy: false });

  useEffect(() => {
    getSignupStatus()
      .then((status) => { setEnabled(status.enabled); setTrialDays(status.trial_days); })
      .catch(() => setEnabled(false));
  }, []);

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consensi.termini || !consensi.privacy) {
      notify.error(tr("Per procedere è necessario accettare termini e informativa privacy."));
      return;
    }
    setLoading(true);
    try {
      const response = await signup({
        ...form,
        vat_number: form.vat_number || undefined,
        plan_code: planFromUrl,
        accetta_termini: consensi.termini,
        accetta_privacy: consensi.privacy,
      });
      setDone(response);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : tr("Registrazione non riuscita"));
    } finally {
      setLoading(false);
    }
  };

  if (enabled === false) {
    return (
      <PublicShell title={tr("Registrazione non disponibile")} subtitle={tr("Su questa installazione gli account vengono creati dall'amministratore.")}>
        <Link href="/login" style={{ color: "#3b82f6" }}>{tr("Vai all'accesso")}</Link>
      </PublicShell>
    );
  }

  if (done) {
    return (
      <PublicShell
        title={tr("Controlla la posta")}
        subtitle={done.message}
        footer={<Link href="/login" style={{ color: "#3b82f6" }}>{tr("Vai all'accesso")}</Link>}
      >
        {/* In sviluppo il backend restituisce il link di verifica: senza SMTP
            configurato sarebbe altrimenti irraggiungibile. In produzione non
            viene mai esposto. */}
        {done.dev_verification_url && (
          <div style={{ padding: 14, borderRadius: 12, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#fbbf24", marginBottom: 8 }}>
              {tr("MODALITÀ SVILUPPO — email non inviata")}
            </div>
            <Link href={done.dev_verification_url.replace(/^https?:\/\/[^/]+/, "")} style={{ color: "#3b82f6", fontSize: 13, wordBreak: "break-all" }}>
              {tr("Conferma l'indirizzo ora")}
            </Link>
          </div>
        )}
      </PublicShell>
    );
  }

  return (
    <PublicShell
      title={tr("Attiva la tua prova gratuita")}
      subtitle={tr("{days} giorni con tutte le funzioni, senza carta di credito.", { days: trialDays })}
      footer={
        <span>
          {tr("Hai già un account?")} <Link href="/login" style={{ color: "#3b82f6" }}>{tr("Accedi")}</Link>
          {" · "}
          <Link href="/pricing" style={{ color: "#3b82f6" }}>{tr("Vedi i piani")}</Link>
        </span>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={publicLabelStyle}>{tr("Azienda")}</label>
          <input required value={form.azienda} onChange={set("azienda")} style={publicInputStyle} placeholder={tr("Ragione sociale")} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={publicLabelStyle}>{tr("Partita IVA")}</label>
            <input value={form.vat_number} onChange={set("vat_number")} style={publicInputStyle} placeholder={tr("Facoltativa")} />
          </div>
          <div>
            <label style={publicLabelStyle}>{tr("Paese")}</label>
            <input required maxLength={2} value={form.paese} onChange={(e) => setForm((p) => ({ ...p, paese: e.target.value.toUpperCase() }))} style={publicInputStyle} />
          </div>
        </div>

        <div>
          <label style={publicLabelStyle}>{tr("Nome e cognome")}</label>
          <input required value={form.nome_referente} onChange={set("nome_referente")} style={publicInputStyle} />
        </div>

        <div>
          <label style={publicLabelStyle}>{tr("Email di lavoro")}</label>
          <input required type="email" autoComplete="email" value={form.email} onChange={set("email")} style={publicInputStyle} />
        </div>

        <div>
          <label style={publicLabelStyle}>{tr("Password")}</label>
          <input required type="password" autoComplete="new-password" minLength={12} value={form.password} onChange={set("password")} style={publicInputStyle} />
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "6px 0 0 0" }}>
            {tr("Almeno 12 caratteri, con maiuscole, minuscole, numeri e simboli.")}
          </p>
        </div>

        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={consensi.termini} onChange={(e) => setConsensi((p) => ({ ...p, termini: e.target.checked }))} style={{ marginTop: 3 }} />
          <span>{tr("Accetto i termini di servizio.")}</span>
        </label>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={consensi.privacy} onChange={(e) => setConsensi((p) => ({ ...p, privacy: e.target.checked }))} style={{ marginTop: 3 }} />
          <span>{tr("Ho letto l'informativa privacy e acconsento al trattamento dei dati.")}</span>
        </label>

        <button type="submit" disabled={loading} style={primaryButtonStyle(loading)}>
          {loading ? tr("Creazione in corso…") : tr("Crea l'area della mia azienda")}
        </button>
      </form>
    </PublicShell>
  );
}

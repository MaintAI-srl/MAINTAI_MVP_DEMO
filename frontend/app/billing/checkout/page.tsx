"use client";

/**
 * Pagina di pagamento **simulato** (solo provider locale).
 *
 * Esiste per rendere provabile l'intero percorso commerciale senza chiavi
 * Stripe, senza tunnel per i webhook e senza carte di prova. Non finge di
 * essere un checkout reale: lo dichiara in modo evidente, perché un finto
 * pagamento scambiato per vero è il modo migliore per fidarsi di un flusso che
 * non è mai stato verificato.
 *
 * Con `BILLING_PROVIDER=stripe` il backend reindirizza al checkout ospitato da
 * Stripe e questa pagina non viene mai raggiunta (l'endpoint di conferma
 * risponde 404).
 */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import PublicShell, { primaryButtonStyle } from "../../components/PublicShell";
import { confirmSimulatedCheckout } from "../../lib/billing";
import { notify } from "@/lib/toast";
import { useT } from "@/app/lib/i18n";

export default function SimulatedCheckoutPage() {
  return (
    <Suspense fallback={null}>
      <SimulatedCheckout />
    </Suspense>
  );
}

function decodeClaims(token: string): { plan_code?: string; billing_interval?: string } {
  // Lettura puramente cosmetica del JWT per mostrare cosa si sta attivando.
  // La verifica della firma la fa il backend: qui non si decide nulla.
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return {};
  }
}

function SimulatedCheckout() {
  const tr = useT();
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <PublicShell title={tr("Sessione di pagamento non valida")} subtitle={tr("Riprova dalla pagina dell'abbonamento.")}>
        <Link href="/settings/billing" style={{ color: "#3b82f6" }}>{tr("Vai all'abbonamento")}</Link>
      </PublicShell>
    );
  }

  const claims = decodeClaims(token);

  const conferma = async () => {
    setLoading(true);
    try {
      const r = await confirmSimulatedCheckout(token);
      if (r.status === "processed") notify.success(tr("Abbonamento attivato."));
      else if (r.status === "duplicate") notify.info(tr("Questo pagamento era già stato registrato."));
      else notify.error(r.detail || tr("Attivazione non riuscita"));
      router.push("/settings/billing");
    } catch (error) {
      notify.error(error instanceof Error ? error.message : tr("Attivazione non riuscita"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <PublicShell
      title={tr("Pagamento simulato")}
      subtitle={tr("Questo ambiente non addebita nulla: confermando si attiva il piano come se il pagamento fosse andato a buon fine.")}
      footer={<Link href="/settings/billing" style={{ color: "#3b82f6" }}>{tr("Annulla e torna indietro")}</Link>}
    >
      <div
        style={{
          padding: 16, borderRadius: 12, marginBottom: 20,
          background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)",
          color: "#fbbf24", fontSize: 13, fontWeight: 700,
        }}
      >
        ⚠️ {tr("Ambiente dimostrativo — nessun dato di pagamento viene richiesto né trattato.")}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
        <Riga etichetta={tr("Piano")} valore={claims.plan_code ?? "—"} />
        <Riga etichetta={tr("Fatturazione")} valore={claims.billing_interval === "yearly" ? tr("Annuale") : tr("Mensile")} />
      </div>

      <button onClick={conferma} disabled={loading} style={primaryButtonStyle(loading)}>
        {loading ? tr("Attivazione…") : tr("Conferma il pagamento simulato")}
      </button>
    </PublicShell>
  );
}

function Riga({ etichetta, valore }: { etichetta: string; valore: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
      <span style={{ color: "var(--text-secondary)" }}>{etichetta}</span>
      <span style={{ fontWeight: 700 }}>{valore}</span>
    </div>
  );
}

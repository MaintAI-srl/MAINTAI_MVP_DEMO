"use client";

/**
 * Banner di stato commerciale, in cima all'app.
 *
 * Mostra solo ciò su cui l'utente può agire: prova in scadenza, pagamento non
 * riuscito, app in sola lettura. Con abbonamento in regola non compare —
 * un banner permanente smette di essere letto proprio quando conta.
 *
 * Lo stato arriva dal backend. Il banner non decide nulla: se sbagliasse, il
 * blocco vero resterebbe comunque quello del server.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../lib/auth";
import { daysUntil, getSubscription, type Entitlements } from "../lib/billing";
import { useT, type Translator } from "@/app/lib/i18n";

type Avviso = { colore: string; testo: string; azione: string } | null;

function costruisciAvviso(ent: Entitlements, tr: Translator): Avviso {
  if (ent.grandfathered) return null;

  if (ent.access_level === "read_only") {
    return {
      colore: "#ef4444",
      testo: tr("Abbonamento non attivo: l'app è in sola lettura. I dati restano consultabili ed esportabili."),
      azione: tr("Riattiva"),
    };
  }

  if (ent.reason === "past_due_grace") {
    return {
      colore: "#f59e0b",
      testo: tr("L'ultimo pagamento non è andato a buon fine. Aggiorna il metodo di pagamento per non perdere l'accesso."),
      azione: tr("Sistema il pagamento"),
    };
  }

  if (ent.cancel_at_period_end && ent.current_period_end) {
    return {
      colore: "#f59e0b",
      testo: tr("Abbonamento disdetto: attivo fino al {date}.", {
        date: new Date(ent.current_period_end).toLocaleDateString("it-IT"),
      }),
      azione: tr("Riattiva"),
    };
  }

  if (ent.status === "trialing") {
    const giorni = daysUntil(ent.trial_ends_at);
    // Sotto i 5 giorni: prima è rumore, dopo è tardi.
    if (giorni !== null && giorni <= 5) {
      return {
        colore: giorni <= 2 ? "#ef4444" : "#f59e0b",
        testo: giorni <= 0
          ? tr("La prova gratuita è terminata.")
          : tr("La prova gratuita termina fra {days} giorni.", { days: giorni }),
        azione: tr("Scegli un piano"),
      };
    }
  }

  return null;
}

export default function PlanBanner() {
  const tr = useT();
  const { isAuthenticated, user } = useAuth();
  const [avviso, setAvviso] = useState<Avviso>(null);

  const carica = useCallback(() => {
    if (!isAuthenticated) return;
    getSubscription()
      .then(({ entitlements }) => setAvviso(costruisciAvviso(entitlements, tr)))
      // Il banner non è mai un motivo per disturbare l'utente: se lo stato non
      // si legge, semplicemente non si mostra nulla.
      .catch(() => setAvviso(null));
  }, [isAuthenticated, tr]);

  useEffect(carica, [carica]);

  // Un 402 nel mezzo del lavoro significa che lo stato è cambiato: si ricarica.
  useEffect(() => {
    window.addEventListener("maintai:billing-changed", carica);
    return () => window.removeEventListener("maintai:billing-changed", carica);
  }, [carica]);

  if (!avviso) return null;

  const puoGestire = user?.ruolo === "responsabile" || user?.ruolo === "superadmin";

  return (
    <div
      role="status"
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        flexWrap: "wrap", gap: 12,
        padding: "9px 16px",
        background: `${avviso.colore}14`,
        borderBottom: `1px solid ${avviso.colore}55`,
        color: avviso.colore,
        fontSize: 13, fontWeight: 600,
      }}
    >
      <span>{avviso.testo}</span>
      {puoGestire && (
        <Link
          href="/settings/billing"
          style={{
            padding: "4px 12px", borderRadius: 999, textDecoration: "none",
            border: `1px solid ${avviso.colore}`, color: avviso.colore, fontWeight: 800, fontSize: 12,
          }}
        >
          {avviso.azione}
        </Link>
      )}
    </div>
  );
}

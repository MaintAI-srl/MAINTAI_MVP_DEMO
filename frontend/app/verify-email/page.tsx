"use client";

/** Conferma dell'indirizzo email tramite token monouso ricevuto per posta. */

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import PublicShell from "../components/PublicShell";
import { verifyEmail } from "../lib/billing";
import { useT } from "@/app/lib/i18n";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const tr = useT();
  const token = useSearchParams().get("token");
  const [stato, setStato] = useState<"attesa" | "ok" | "errore">("attesa");
  const [messaggio, setMessaggio] = useState("");
  // React 18 in dev monta due volte: senza guardia il token verrebbe consumato
  // dalla prima chiamata e la seconda mostrerebbe "link non valido".
  const eseguito = useRef(false);

  useEffect(() => {
    if (!token || eseguito.current) return;
    eseguito.current = true;
    verifyEmail(token)
      .then((r) => { setStato("ok"); setMessaggio(r.message); })
      .catch((e) => { setStato("errore"); setMessaggio(e instanceof Error ? e.message : ""); });
  }, [token]);

  if (!token) {
    return (
      <PublicShell title={tr("Link non valido")} subtitle={tr("Manca il codice di verifica.")}>
        <Link href="/login" style={{ color: "#3b82f6" }}>{tr("Vai all'accesso")}</Link>
      </PublicShell>
    );
  }

  return (
    <PublicShell
      title={stato === "ok" ? tr("Indirizzo confermato") : stato === "errore" ? tr("Verifica non riuscita") : tr("Verifica in corso…")}
      subtitle={messaggio || undefined}
      footer={<Link href="/login" style={{ color: "#3b82f6" }}>{tr("Vai all'accesso")}</Link>}
    >
      <div style={{ fontSize: 44, textAlign: "center" }}>
        {stato === "ok" ? "✅" : stato === "errore" ? "⚠️" : "⏳"}
      </div>
    </PublicShell>
  );
}

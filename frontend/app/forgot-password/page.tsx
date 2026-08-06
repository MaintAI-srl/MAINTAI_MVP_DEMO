"use client";

/** Richiesta di reimpostazione password.
 *
 * La risposta è identica per un indirizzo registrato e uno sconosciuto: la UI
 * non deve reintrodurre l'enumerazione che il backend evita con cura. */

import { useState } from "react";
import Link from "next/link";
import PublicShell, { primaryButtonStyle, publicInputStyle, publicLabelStyle } from "../components/PublicShell";
import { forgotPassword } from "../lib/billing";
import { useT } from "@/app/lib/i18n";

export default function ForgotPasswordPage() {
  const tr = useT();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [inviato, setInviato] = useState<{ message: string; devUrl?: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await forgotPassword(email);
      setInviato({ message: r.message, devUrl: r.dev_reset_url });
    } catch {
      // Anche in errore si mostra lo stesso esito: un fallimento distinguibile
      // direbbe comunque qualcosa su quali indirizzi esistono.
      setInviato({ message: tr("Se l'indirizzo è registrato, riceverai le istruzioni via email.") });
    } finally {
      setLoading(false);
    }
  };

  if (inviato) {
    return (
      <PublicShell title={tr("Controlla la posta")} subtitle={inviato.message} footer={<Link href="/login" style={{ color: "#3b82f6" }}>{tr("Torna all'accesso")}</Link>}>
        {inviato.devUrl && (
          <div style={{ padding: 14, borderRadius: 12, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#fbbf24", marginBottom: 8 }}>{tr("MODALITÀ SVILUPPO — email non inviata")}</div>
            <Link href={inviato.devUrl.replace(/^https?:\/\/[^/]+/, "")} style={{ color: "#3b82f6", fontSize: 13 }}>{tr("Reimposta la password ora")}</Link>
          </div>
        )}
      </PublicShell>
    );
  }

  return (
    <PublicShell
      title={tr("Password dimenticata")}
      subtitle={tr("Inserisci l'indirizzo con cui accedi: ti invieremo un link per reimpostarla.")}
      footer={<Link href="/login" style={{ color: "#3b82f6" }}>{tr("Torna all'accesso")}</Link>}
    >
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={publicLabelStyle}>{tr("Email")}</label>
          <input required type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} style={publicInputStyle} />
        </div>
        <button type="submit" disabled={loading} style={primaryButtonStyle(loading)}>
          {loading ? tr("Invio in corso…") : tr("Invia il link")}
        </button>
      </form>
    </PublicShell>
  );
}

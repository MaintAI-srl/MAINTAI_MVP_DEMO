"use client";

/** Impostazione della nuova password tramite token monouso. */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import PublicShell, { primaryButtonStyle, publicInputStyle, publicLabelStyle } from "../components/PublicShell";
import { resetPassword } from "../lib/billing";
import { notify } from "@/lib/toast";
import { useT } from "@/app/lib/i18n";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const tr = useT();
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [conferma, setConferma] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== conferma) {
      notify.error(tr("Le due password non coincidono."));
      return;
    }
    setLoading(true);
    try {
      const r = await resetPassword(token!, password);
      notify.success(r.message);
      router.push("/login");
    } catch (error) {
      notify.error(error instanceof Error ? error.message : tr("Reimpostazione non riuscita"));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <PublicShell title={tr("Link non valido")} subtitle={tr("Manca il codice di reimpostazione.")}>
        <Link href="/forgot-password" style={{ color: "#3b82f6" }}>{tr("Richiedine uno nuovo")}</Link>
      </PublicShell>
    );
  }

  return (
    <PublicShell
      title={tr("Nuova password")}
      subtitle={tr("Impostandola verranno chiuse tutte le sessioni aperte su questo account.")}
      footer={<Link href="/login" style={{ color: "#3b82f6" }}>{tr("Torna all'accesso")}</Link>}
    >
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={publicLabelStyle}>{tr("Nuova password")}</label>
          <input required type="password" minLength={12} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} style={publicInputStyle} />
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "6px 0 0 0" }}>
            {tr("Almeno 12 caratteri, con maiuscole, minuscole, numeri e simboli.")}
          </p>
        </div>
        <div>
          <label style={publicLabelStyle}>{tr("Conferma password")}</label>
          <input required type="password" minLength={12} autoComplete="new-password" value={conferma} onChange={(e) => setConferma(e.target.value)} style={publicInputStyle} />
        </div>
        <button type="submit" disabled={loading} style={primaryButtonStyle(loading)}>
          {loading ? tr("Salvataggio…") : tr("Imposta la password")}
        </button>
      </form>
    </PublicShell>
  );
}

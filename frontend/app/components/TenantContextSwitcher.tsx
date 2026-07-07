"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";

type TenantOption = {
  id: number;
  nome: string;
  is_active: boolean;
};

export const TENANT_CONTEXT_KEY = "maintai_tenant_context";

export function getTenantContext(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TENANT_CONTEXT_KEY);
}

export function setTenantContext(tenantId: string | null) {
  if (typeof window === "undefined") return;
  if (tenantId) localStorage.setItem(TENANT_CONTEXT_KEY, tenantId);
  else localStorage.removeItem(TENANT_CONTEXT_KEY);
}

/**
 * Selettore contesto tenant per superadmin (sidebar).
 * Carica la lista reale dei tenant da /tenants e permette di operare
 * su qualsiasi cliente: tutte le chiamate API successive inviano
 * l'header X-Tenant-Id del tenant selezionato.
 */
export default function TenantContextSwitcher({ defaultTenantName }: { defaultTenantName?: string }) {
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [current, setCurrent] = useState<string>("");
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- init one-shot dal localStorage all'mount; sincrono e senza cascata
    setCurrent(getTenantContext() || "");
    apiGet<TenantOption[]>("/tenants")
      .then((data) => {
        setTenants(data);
        setLoadError(false);
        // Se il contesto salvato punta a un tenant che non esiste più, ripulisci
        const saved = getTenantContext();
        if (saved && !data.some((t) => String(t.id) === saved)) {
          setTenantContext(null);
          setCurrent("");
        }
      })
      .catch(() => setLoadError(true));
  }, []);

  const activeTenant = tenants.find((t) => String(t.id) === current);

  const handleChange = (val: string) => {
    setTenantContext(val || null);
    setCurrent(val);
    // Ricarica per rifare tutte le fetch con il nuovo contesto
    window.location.reload();
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 8.5, color: "rgba(91,143,255,0.4)", display: "block", marginBottom: 4, letterSpacing: "0.16em", textTransform: "uppercase", fontWeight: 700 }}>
        Contesto Tenant
      </label>
      <select
        style={{
          background: "rgba(91,143,255,0.07)",
          color: "#90b8ff",
          border: "1px solid rgba(91,143,255,0.18)",
          borderRadius: 7,
          fontSize: 11,
          padding: "5px 8px",
          width: "100%",
          outline: "none",
          fontFamily: "var(--font-body)",
        }}
        value={current}
        onChange={(e) => handleChange(e.target.value)}
      >
        <option value="">
          {defaultTenantName ? `Predefinito — ${defaultTenantName}` : "Predefinito (tenant del login)"}
        </option>
        {tenants.map((t) => (
          <option key={t.id} value={String(t.id)}>
            {t.nome} (#{t.id}){t.is_active ? "" : " — SOSPESO"}
          </option>
        ))}
      </select>
      {loadError && (
        <div style={{ fontSize: 10, color: "#f59e0b", marginTop: 4 }}>
          Lista clienti non disponibile — riprova più tardi.
        </div>
      )}
      {activeTenant && (
        <div style={{ fontSize: 10, color: "#5b8fff", marginTop: 5, display: "flex", alignItems: "center", gap: 5, fontWeight: 700, letterSpacing: "0.06em" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#5b8fff", display: "inline-block" }} />
          <span>OPERI SU: {activeTenant.nome.toUpperCase()}</span>
        </div>
      )}
    </div>
  );
}

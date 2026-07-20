"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { apiDelete, apiGet, apiPut } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { ModuleStatus, ModulesResponse } from "../../lib/modules";
import { notify } from "@/lib/toast";
import { getTenantContext } from "../../components/TenantContextSwitcher";

const CATEGORY_LABELS: Record<string, string> = {
  operazioni: "Operazioni",
  risorse: "Risorse",
  ai: "AI",
  agenti: "Agenti AI",
  integrazioni: "Integrazioni",
  admin: "Amministrazione",
  campo: "Campo",
  desktop: "Desktop",
};

function categoryLabel(category: string) {
  return CATEGORY_LABELS[category] ?? category;
}

export default function FunzionalitaPage() {
  const { reloadModules } = useAuth();
  const [modules, setModules] = useState<ModuleStatus[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasOverride, setHasOverride] = useState(false);
  const [tenantContext, setTenantContext] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await apiGet<ModulesResponse>("/modules");
      const rows = data.modules ?? [];
      setModules(rows);
      setSelected(new Set(rows.filter((module) => module.enabled).map((module) => module.id)));
      setHasOverride(Boolean(data.has_override));
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "Errore caricamento funzionalita");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setTenantContext(getTenantContext());
    load();
  }, []);

  async function resetOverride() {
    setSaving(true);
    try {
      const data = await apiDelete<ModulesResponse>("/admin/modules/override");
      const rows = data.modules ?? [];
      setModules(rows);
      setSelected(new Set(rows.filter((module) => module.enabled).map((module) => module.id)));
      setHasOverride(Boolean(data.has_override));
      await reloadModules();
      notify.success("Override rimosso: il cliente usa la configurazione globale");
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "Errore ripristino configurazione");
    } finally {
      setSaving(false);
    }
  }

  const grouped = useMemo(() => {
    return modules.reduce<Record<string, ModuleStatus[]>>((acc, module) => {
      const key = module.category || "altro";
      acc[key] = acc[key] ?? [];
      acc[key].push(module);
      return acc;
    }, {});
  }, [modules]);

  function toggle(module: ModuleStatus) {
    setSelected((prev) => {
      const next = new Set(prev);
      const byId = new Map(modules.map((item) => [item.id, item]));
      const addWithDependencies = (moduleId: string) => {
        const current = byId.get(moduleId);
        current?.requires.forEach(addWithDependencies);
        next.add(moduleId);
      };
      const removeWithDependents = (moduleId: string) => {
        next.delete(moduleId);
        modules
          .filter((candidate) => candidate.requires.includes(moduleId))
          .forEach((candidate) => removeWithDependents(candidate.id));
      };
      if (next.has(module.id)) {
        removeWithDependents(module.id);
      } else {
        addWithDependencies(module.id);
      }
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const data = await apiPut<ModulesResponse>("/admin/modules", { enabled: Array.from(selected) });
      const rows = data.modules ?? [];
      setModules(rows);
      setSelected(new Set(rows.filter((module) => module.enabled).map((module) => module.id)));
      setHasOverride(Boolean(data.has_override));
      await reloadModules();
      notify.success(tenantContext ? "Funzionalita del cliente aggiornate" : "Funzionalita globali aggiornate");
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "Errore salvataggio funzionalita");
    } finally {
      setSaving(false);
    }
  }

  const enabledCount = selected.size;
  const dirty = modules.some((module) => module.enabled !== selected.has(module.id));

  return (
    <main style={{ minHeight: "100vh", background: "var(--surface-1)", color: "var(--text-primary)", padding: "32px 24px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>Funzionalita MaintAI</div>
          <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: 13, maxWidth: 760 }}>
            Attiva o disattiva i moduli visibili nell&apos;applicazione. Le dipendenze vengono gestite automaticamente.
          </p>
          <div style={{
            marginTop: 10,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 700,
            border: `1px solid ${tenantContext ? "rgba(59,130,246,.45)" : "var(--border-default)"}`,
            background: tenantContext ? "rgba(59,130,246,.10)" : "var(--surface-2)",
            color: tenantContext ? "#93c5fd" : "var(--text-muted)",
          }}>
            {tenantContext
              ? `Stai configurando il cliente del contesto attivo (tenant #${tenantContext})${hasOverride ? " — override attivo" : " — nessun override, eredita la config globale"}`
              : "Stai configurando la configurazione GLOBALE (vale per tutti i clienti senza override)"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{enabledCount}/{modules.length} attive</span>
          {tenantContext && hasOverride && (
            <button
              onClick={resetOverride}
              disabled={loading || saving}
              style={{ ...secondaryButton, color: "#f59e0b", borderColor: "rgba(245,158,11,.4)" }}
              title="Rimuove l'override: il cliente torna alla configurazione globale"
            >
              Ripristina globale
            </button>
          )}
          <button
            onClick={load}
            disabled={loading || saving}
            style={secondaryButton}
          >
            Aggiorna
          </button>
          <button
            onClick={save}
            disabled={!dirty || saving}
            style={{
              ...primaryButton,
              opacity: !dirty || saving ? 0.55 : 1,
              cursor: !dirty || saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Salvataggio..." : "Salva modifiche"}
          </button>
        </div>
      </header>

      {loading ? (
        <div style={panelStyle}>Caricamento moduli...</div>
      ) : (
        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          {Object.entries(grouped).map(([category, rows]) => (
            <div key={category} style={panelStyle}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#60a5fa", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 14 }}>
                {categoryLabel(category)}
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {rows.map((module) => {
                  const checked = selected.has(module.id);
                  return (
                    <label
                      key={module.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "24px 1fr",
                        gap: 12,
                        padding: 12,
                        borderRadius: 8,
                        border: `1px solid ${checked ? "rgba(34,197,94,.45)" : "var(--border-default)"}`,
                        background: checked ? "rgba(5,46,22,.28)" : "var(--surface-2)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(module)}
                        style={{ marginTop: 3, width: 16, height: 16, accentColor: "#22c55e" }}
                      />
                      <span>
                        <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <strong style={{ fontSize: 14 }}>{module.name}</strong>
                          <code style={codePill}>{module.id}</code>
                        </span>
                        <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45, marginTop: 5 }}>
                          {module.description}
                        </span>
                        {module.requires.length > 0 && (
                          <span style={{ display: "block", fontSize: 11, color: "#93c5fd", marginTop: 7 }}>
                            Richiede: {module.requires.join(", ")}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}

const panelStyle: CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--border-strong)",
  borderRadius: 8,
  padding: 18,
};

const primaryButton: CSSProperties = {
  background: "linear-gradient(135deg,#047857,#059669)",
  color: "#ecfdf5",
  border: "1px solid #10b981",
  borderRadius: 8,
  padding: "10px 16px",
  fontSize: 13,
  fontWeight: 800,
};

const secondaryButton: CSSProperties = {
  background: "var(--surface-2)",
  color: "var(--text-muted)",
  border: "1px solid var(--border-default)",
  borderRadius: 8,
  padding: "10px 14px",
  fontSize: 13,
  cursor: "pointer",
};

const codePill: CSSProperties = {
  padding: "2px 6px",
  borderRadius: 999,
  background: "rgba(96,165,250,.12)",
  color: "#93c5fd",
  fontSize: 10,
  border: "1px solid rgba(96,165,250,.18)",
};

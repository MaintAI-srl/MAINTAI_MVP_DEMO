"use client";

import { LOCALES, LOCALE_LABELS, useI18n, type Locale } from "@/app/lib/i18n";

const SHORT: Record<Locale, string> = { it: "IT", en: "EN" };

/**
 * Selettore lingua IT/EN.
 *
 * `variant="switch"` è il segmented control della topbar desktop;
 * `variant="compact"` è la versione a pillola singola per la shell mobile e
 * per il login, dove lo spazio orizzontale è poco.
 */
export default function LanguageSwitcher({ variant = "switch" }: { variant?: "switch" | "compact" }) {
  const { locale, setLocale, t } = useI18n();

  if (variant === "compact") {
    const next: Locale = locale === "it" ? "en" : "it";
    return (
      <button
        type="button"
        onClick={() => setLocale(next)}
        title={t("Lingua: {lingua}", { lingua: LOCALE_LABELS[locale] })}
        aria-label={t("Cambia lingua")}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
          height: 32, padding: "0 10px",
          background: "var(--surface-3)",
          border: "1px solid var(--border-default)",
          borderRadius: 8,
          color: "var(--text-primary)",
          fontSize: 11, fontWeight: 800, letterSpacing: "0.06em",
          cursor: "pointer",
        }}
      >
        <span aria-hidden>🌐</span>
        {SHORT[locale]}
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={t("Cambia lingua")}
      style={{
        display: "inline-flex", alignItems: "center",
        padding: 2, gap: 2,
        background: "var(--surface-3)",
        border: "1px solid var(--border-default)",
        borderRadius: 8,
      }}
    >
      {LOCALES.map((code) => {
        const active = code === locale;
        return (
          <button
            key={code}
            type="button"
            onClick={() => setLocale(code)}
            aria-pressed={active}
            title={LOCALE_LABELS[code]}
            style={{
              height: 26, minWidth: 30, padding: "0 7px",
              background: active ? "var(--cobalt-dim)" : "transparent",
              border: active ? "1px solid var(--cobalt-border)" : "1px solid transparent",
              borderRadius: 6,
              color: active ? "var(--cobalt)" : "var(--text-muted)",
              fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em",
              cursor: "pointer",
              transition: "all 140ms",
            }}
          >
            {SHORT[code]}
          </button>
        );
      })}
    </div>
  );
}

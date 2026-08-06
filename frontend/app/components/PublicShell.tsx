"use client";

/**
 * Contenitore delle pagine pubbliche (prezzi, registrazione, verifica, reset).
 *
 * Vive fuori dalla shell autenticata: queste pagine sono raggiungibili senza
 * sessione e non devono mostrare né sidebar né dati del tenant. Lo stile
 * ricalca quello della pagina di login, così il passaggio sito → registrazione
 * → app non sembra un cambio di prodotto.
 */

import Link from "next/link";
import LanguageSwitcher from "./LanguageSwitcher";

export default function PublicShell({
  title,
  subtitle,
  maxWidth = 520,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  maxWidth?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-base)",
        color: "var(--text-primary)",
        padding: "calc(24px + env(safe-area-inset-top, 0px)) 16px calc(24px + env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div style={{ width: "100%", maxWidth }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <Link href="/login" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- logo statico, next/image non porta benefici qui */}
            <img src="/logo.png" alt="MaintAI" style={{ width: 34, height: 34, objectFit: "contain" }} />
            <span style={{ fontWeight: 800, letterSpacing: "0.1em", fontSize: 18 }}>MAINTAI</span>
          </Link>
          <LanguageSwitcher />
        </div>

        <div
          style={{
            padding: "clamp(24px, 6vw, 40px)",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-strong)",
            borderRadius: 22,
            boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
          }}
        >
          <h1 style={{ fontSize: "clamp(24px, 6vw, 30px)", margin: "0 0 8px 0", fontWeight: 800 }}>{title}</h1>
          {subtitle && (
            <p style={{ color: "var(--text-secondary)", margin: "0 0 24px 0", fontSize: 15, lineHeight: 1.5 }}>
              {subtitle}
            </p>
          )}
          {children}
        </div>

        {footer && (
          <div style={{ marginTop: 18, textAlign: "center", fontSize: 13, color: "var(--text-muted)" }}>{footer}</div>
        )}
      </div>
    </div>
  );
}

export const publicInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0 14px",
  minHeight: 48,
  background: "var(--bg-base)",
  border: "1px solid var(--border-default)",
  borderRadius: 12,
  color: "var(--text-primary)",
  outline: "none",
  fontSize: 15,
  boxSizing: "border-box",
};

export const publicLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--text-secondary)",
  marginBottom: 6,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontWeight: 700,
};

export function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "14px",
    minHeight: 52,
    background: disabled ? "#1e3a5f" : "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    color: "white",
    border: "none",
    borderRadius: 12,
    fontWeight: 800,
    fontSize: 16,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

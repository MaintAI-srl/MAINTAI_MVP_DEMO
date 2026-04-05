"use client";

import { useAuth } from "../lib/auth";

export default function DemoBanner() {
  const { user, logout } = useAuth();

  if (!user?.isDemo) return null;

  return (
    <div style={{
      background: "var(--amber-dim)",
      color: "var(--amber)",
      padding: "10px 18px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "13px",
      fontWeight: 600,
      borderBottom: "1px solid var(--amber-dim)",
      gap: "14px",
      position: "relative",
      zIndex: 1100,
      fontFamily: "var(--font-display)",
      letterSpacing: "0.05em",
      textTransform: "uppercase",
    }}>
      <span style={{ fontSize: "16px" }}>🎭</span>
      <span style={{ letterSpacing: "0.025em" }}>
        <strong>MODALITÀ DEMO</strong> — Stai visualizzando dati simulati. Nessuna modifica influirà sul database reale.
      </span>
      <button
        onClick={logout}
        style={{
          background: "#92400e",
          color: "white",
          border: "none",
          padding: "4px 10px",
          borderRadius: "4px",
          fontSize: "11px",
          fontWeight: 600,
          cursor: "pointer",
          transition: "opacity 0.2s",
        }}
        onMouseOver={(e) => e.currentTarget.style.opacity = "0.8"}
        onMouseOut={(e) => e.currentTarget.style.opacity = "1"}
      >
        ESCI DALLA DEMO
      </button>
    </div>
  );
}

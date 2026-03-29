"use client";

export default function SectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "320px",
      gap: "16px",
      color: "var(--text-secondary)",
    }}>
      <div style={{
        fontSize: "32px",
        background: "rgba(239,68,68,0.1)",
        border: "1px solid rgba(239,68,68,0.3)",
        borderRadius: "50%",
        width: "64px",
        height: "64px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        ⚠
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: 600, fontSize: "16px", color: "var(--text-primary)", marginBottom: "6px" }}>
          Errore nel caricamento
        </div>
        <div style={{ fontSize: "13px", maxWidth: "380px" }}>
          {error.message || "Si è verificato un errore imprevisto."}
        </div>
      </div>
      <button
        onClick={reset}
        style={{
          padding: "8px 20px",
          background: "var(--accent)",
          color: "white",
          border: "none",
          borderRadius: "6px",
          fontSize: "13px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Riprova
      </button>
    </div>
  );
}

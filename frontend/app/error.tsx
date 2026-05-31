"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error("Global Error Boundary caught an error:", error);
  }, [error]);

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "var(--bg-base)",
      padding: "24px"
    }}>
      <div style={{
        maxWidth: "480px",
        width: "100%",
        backgroundColor: "white",
        borderRadius: "12px",
        boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
        padding: "32px",
        textAlign: "center"
      }}>
        <div style={{
          display: "flex",
          justifyContent: "center",
          marginBottom: "20px"
        }}>
          <div style={{
            backgroundColor: "#fee2e2",
            padding: "16px",
            borderRadius: "50%",
            color: "var(--red)"
          }}>
            <AlertCircle size={48} />
          </div>
        </div>
        
        <h2 style={{
          fontSize: "24px",
          fontWeight: "600",
          color: "var(--bg-elevated)",
          marginBottom: "12px",
          fontFamily: "'Barlow Condensed', sans-serif"
        }}>
          Si è verificato un errore
        </h2>
        
        <p style={{
          color: "var(--text-muted)",
          marginBottom: "24px",
          fontSize: "15px",
          lineHeight: "1.5"
        }}>
          Ci scusiamo per l&apos;inconveniente. L&apos;applicazione ha riscontrato un problema inatteso: {error.message || "Errore sconosciuto"}.
        </p>

        <button
          onClick={() => reset()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            backgroundColor: "#0ea5e9", // MaintAI blue
            color: "white",
            border: "none",
            borderRadius: "6px",
            padding: "12px 24px",
            fontSize: "16px",
            fontWeight: "500",
            cursor: "pointer",
            width: "100%",
            transition: "background-color 0.2s"
          }}
          onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#0284c7'}
          onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#0ea5e9'}
        >
          <RefreshCw size={18} />
          Riprova Caricamento
        </button>
      </div>
    </div>
  );
}

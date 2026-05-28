"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
// API_BASE locale — la pagina di stampa usa il suo layout isolato, non accede agli alias
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? (process.env.NODE_ENV === "production" ? "/api" : "https://maintai-v3.onrender.com");

interface QRResponse {
  asset_id: number;
  asset_code: string;
  asset_nome: string;
  qr_b64: string;
}

export default function PrintAssetQR() {
  const params = useParams();
  const assetId = params?.assetId as string;

  const [qr, setQr] = useState<QRResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!assetId) return;

    const token = typeof window !== "undefined" ? localStorage.getItem("maintai_jwt") : null;
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    fetch(`${API_BASE}/assets/${assetId}/qr`, {
      credentials: "include",
      headers,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Errore ${r.status}`);
        return r.json() as Promise<QRResponse>;
      })
      .then((data) => {
        setQr(data);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Errore caricamento";
        setError(msg);
      });
  }, [assetId]);

  // Stampa automatica quando i dati sono pronti
  useEffect(() => {
    if (!qr) return;
    const timer = setTimeout(() => {
      window.print();
    }, 300);
    return () => clearTimeout(timer);
  }, [qr]);

  if (error) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#ef4444", fontSize: "16px" }}>
        Errore: {error}
      </div>
    );
  }

  if (!qr) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#6b7280", fontSize: "14px" }}>
        Caricamento QR...
      </div>
    );
  }

  const APP_URL = process.env.NEXT_PUBLIC_APP_BASE ?? "https://maintai.vercel.app";
  const assetUrl = `${APP_URL}/asset?id=${assetId}`;

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      padding: "40px 20px",
      background: "#ffffff",
    }}>
      {/* QR Code grande */}
      <div style={{
        background: "#ffffff",
        border: "2px solid #e5e7eb",
        borderRadius: "8px",
        padding: "16px",
        marginBottom: "24px",
        lineHeight: 0,
      }}>
        <img
          src={`data:image/png;base64,${qr.qr_b64}`}
          alt={`QR code asset ${qr.asset_code}`}
          width={600}
          height={600}
          style={{ display: "block" }}
        />
      </div>

      {/* Codice asset */}
      <div style={{
        fontSize: "28px",
        fontWeight: 700,
        color: "#111827",
        letterSpacing: "2px",
        marginBottom: "8px",
        textTransform: "uppercase",
      }}>
        {qr.asset_code || `ASSET-${assetId}`}
      </div>

      {/* Nome asset */}
      {qr.asset_nome && (
        <div style={{
          fontSize: "18px",
          color: "#374151",
          marginBottom: "16px",
          textAlign: "center",
        }}>
          {qr.asset_nome}
        </div>
      )}

      {/* URL */}
      <div style={{
        fontSize: "11px",
        color: "var(--text-muted)",
        textAlign: "center",
        maxWidth: "500px",
        wordBreak: "break-all",
      }}>
        {assetUrl}
      </div>

      {/* Logo / branding */}
      <div style={{
        marginTop: "32px",
        fontSize: "12px",
        color: "#d1d5db",
        letterSpacing: "1px",
        textTransform: "uppercase",
      }}>
        MaintAI — Sistema di Gestione Manutenzione
      </div>

      {/* Pulsante stampa visibile solo a video */}
      <button
        onClick={() => window.print()}
        style={{
          marginTop: "24px",
          padding: "10px 28px",
          background: "#1d4ed8",
          color: "#ffffff",
          border: "none",
          borderRadius: "8px",
          cursor: "pointer",
          fontSize: "14px",
          fontWeight: 600,
        }}
        className="no-print"
      >
        Stampa
      </button>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { margin: 0; }
          body { margin: 0; }
        }
      `}</style>
    </div>
  );
}

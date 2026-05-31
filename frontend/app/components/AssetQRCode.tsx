"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "../lib/api";
import { notify } from "@/lib/toast";

interface AssetQRCodeProps {
  assetId: number;
  assetCode?: string;
  assetNome?: string;
}

interface QRResponse {
  asset_id: number;
  asset_code: string;
  asset_nome: string;
  qr_b64: string;
}

export default function AssetQRCode({ assetId, assetCode, assetNome }: AssetQRCodeProps) {
  const [qr, setQr] = useState<QRResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!assetId) return;
    // TODO(sec-04): revisione umana - accettato come init di loading state prima di fetch asincrono
    // eslint-disable-next-line react-hooks/set-state-in-effect -- init loading state prima del fetch; pattern standard data fetching
    setLoading(true);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetta errore prima del fetch; pattern standard data fetching
    setError(null);

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
        const msg = err instanceof Error ? err.message : "Errore caricamento QR";
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, [assetId]);

  function handleStampa() {
    window.open(`/print/asset-qr/${assetId}`, "_blank");
  }

  function handleDownload() {
    if (!qr) return;
    const link = document.createElement("a");
    link.href = `data:image/png;base64,${qr.qr_b64}`;
    link.download = `qr-asset-${assetCode || assetId}.png`;
    link.click();
  }

  if (loading) {
    return (
      <div style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "10px",
        padding: "20px",
        textAlign: "center",
        color: "var(--text-secondary)",
        fontSize: "13px",
      }}>
        Generazione QR in corso...
      </div>
    );
  }

  if (error || !qr) {
    return (
      <div style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "10px",
        padding: "20px",
        textAlign: "center",
        color: "var(--text-secondary)",
        fontSize: "13px",
      }}>
        <div style={{ fontSize: "24px", marginBottom: "8px" }}>QR</div>
        <div>{error || "QR non disponibile"}</div>
      </div>
    );
  }

  return (
    <div style={{
      background: "var(--bg-elevated)",
      border: "1px solid var(--border)",
      borderRadius: "10px",
      padding: "16px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "12px",
    }}>
      {/* QR Image */}
      <div style={{
        background: "#ffffff",
        padding: "8px",
        borderRadius: "8px",
        display: "inline-block",
        lineHeight: 0,
      }}>
        <img
          src={`data:image/png;base64,${qr.qr_b64}`}
          alt={`QR code asset ${qr.asset_code || assetId}`}
          width={200}
          height={200}
          style={{ display: "block" }}
        />
      </div>

      {/* Info */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontSize: "13px", color: "var(--text-primary)" }}>
          {qr.asset_code || assetCode || `Asset #${assetId}`}
        </div>
        {(qr.asset_nome || assetNome) && (
          <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
            {qr.asset_nome || assetNome}
          </div>
        )}
        <div style={{ fontSize: "10px", color: "var(--text-secondary)", marginTop: "4px", opacity: 0.6 }}>
          Scansiona per aprire l&apos;asset nel sistema
        </div>
      </div>

      {/* Azioni */}
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={handleStampa}
          title="Apre una pagina di stampa ottimizzata"
          style={{
            background: "var(--blue)",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            padding: "7px 14px",
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: 600,
          }}
        >
          Stampa QR
        </button>
        <button
          onClick={handleDownload}
          title="Scarica PNG ad alta risoluzione"
          style={{
            background: "transparent",
            color: "var(--text-primary)",
            border: "1px solid var(--border-strong)",
            borderRadius: "6px",
            padding: "7px 14px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          Scarica PNG
        </button>
      </div>
    </div>
  );
}

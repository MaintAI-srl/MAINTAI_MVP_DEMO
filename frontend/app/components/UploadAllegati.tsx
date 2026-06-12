"use client";

import { useState, useEffect } from "react";
import { API_BASE, apiGet, apiUpload } from "../lib/api";
import { notify } from "@/lib/toast";

type Allegato = {
  id: number;
  nome_file: string;
  url: string;
  tipo_mime: string;
  creato_il: string;
};

type Props = {
  ticketId: number;
  onUploadSuccess?: () => void;
};

export default function UploadAllegati({ ticketId, onUploadSuccess }: Props) {
  const [allegati, setAllegati] = useState<Allegato[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    loadAllegati();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  async function loadAllegati() {
    try {
      const data = await apiGet<Allegato[]>(`/tickets/${ticketId}/allegati`);
      setAllegati(data);
    } catch (e) {
      console.error("Errore nel caricamento allegati", e);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      await apiUpload(`/tickets/${ticketId}/allegati`, formData);
      await loadAllegati();
      if (onUploadSuccess) onUploadSuccess();
    } catch (err) {
      notify.error(err instanceof Error ? err.message : "Errore nel caricamento");
    } finally {
      setUploading(false);
      // Reset input
      e.target.value = "";
    }
  }

  /**
   * Scarica un allegato tramite l'endpoint autenticato e apre/scarica il blob.
   * L'url nel record è già nella forma /tickets/allegati/{id}/download (endpoint API).
   */
  async function handleAllegatoClick(a: Allegato, e: React.MouseEvent) {
    e.preventDefault();
    try {
      // L'url è relativo al backend (es. /tickets/allegati/123/download)
      const apiUrl = `${API_BASE}${a.url}`;
      const res = await fetch(apiUrl, {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) {
        notify.error("Impossibile scaricare il file.");
        return;
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);

      const isImage = a.tipo_mime?.startsWith("image/");
      if (isImage) {
        // Apri immagine in nuova scheda
        window.open(objectUrl, "_blank", "noopener,noreferrer");
      } else {
        // Scarica come file
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = a.nome_file || "allegato";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      // Rilascia la URL object dopo un breve timeout
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    } catch {
      notify.error("Errore durante il download del file.");
    }
  }

  const isImage = (mime: string | undefined | null) =>
    (mime ?? "").startsWith("image/");

  return (
    <div style={{ marginTop: 12 }}>
      {/* Campo di Upload */}
      <div style={{ position: "relative", marginBottom: 12 }}>
        <input
          type="file"
          accept="image/*,.pdf,.doc,.docx"
          id={`upload-${ticketId}`}
          onChange={handleFileChange}
          style={{ display: "none" }}
          disabled={uploading}
        />
        <label
          htmlFor={`upload-${ticketId}`}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: "10px 16px", background: "rgba(99,102,241,0.1)",
            border: "1px dashed rgba(99,102,241,0.4)", borderRadius: 10,
            color: "#818cf8", cursor: uploading ? "not-allowed" : "pointer",
            fontWeight: 600, fontSize: 13, textAlign: "center", width: "100%"
          }}
        >
          {uploading ? (
            <span>Caricamento...</span>
          ) : (
            <>
              <span style={{ fontSize: 18 }}>📸</span>
              <span>Aggiungi Foto o Documento</span>
            </>
          )}
        </label>
      </div>

      {/* Galleria Allegati */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 8 }}>
        {allegati.map((a) => (
          <div
            key={a.id}
            style={{
              position: "relative", borderRadius: 8, overflow: "hidden",
              aspectRatio: "1/1", border: "1px solid var(--border-color)",
              cursor: "pointer",
            }}
          >
            {isImage(a.tipo_mime) ? (
              // Immagine: mostra thumbnail con click autenticato
              <button
                onClick={(e) => handleAllegatoClick(a, e)}
                style={{
                  background: "none", border: "none", padding: 0,
                  width: "100%", height: "100%", cursor: "pointer",
                }}
                title={a.nome_file}
                aria-label={`Apri immagine ${a.nome_file}`}
              >
                <img
                  src={`${API_BASE}${a.url}`}
                  alt={a.nome_file}
                  style={{ width: "100%", height: 80, objectFit: "cover", display: "block" }}
                  onError={(ev) => {
                    // Fallback se l'immagine non si carica via src diretto
                    (ev.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </button>
            ) : (
              <button
                onClick={(e) => handleAllegatoClick(a, e)}
                style={{
                  display: "flex", height: 80, width: "100%",
                  background: "var(--border-subtle)", alignItems: "center",
                  justifyContent: "center", fontSize: 20,
                  color: "var(--text-soft)", border: "none", cursor: "pointer",
                  position: "relative",
                }}
                title={a.nome_file}
                aria-label={`Scarica ${a.nome_file}`}
              >
                📄
                <div
                  style={{
                    position: "absolute", bottom: 0, left: 0, right: 0,
                    padding: 2, background: "rgba(0,0,0,0.5)", fontSize: 8,
                    textAlign: "center", overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                >
                  {a.nome_file}
                </div>
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

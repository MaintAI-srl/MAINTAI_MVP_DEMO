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

  const isImage = (mime: string) => mime.startsWith("image/");

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
            <span>⌛ Caricamento...</span>
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
          <div key={a.id} style={{ position: "relative", borderRadius: 8, overflow: "hidden", aspectRatio: "1/1", border: "1px solid var(--border-color)" }}>
            {isImage(a.tipo_mime) ? (
              <a href={`${API_BASE}${a.url}`} target="_blank" rel="noopener noreferrer">
                <img 
                  src={`${API_BASE}${a.url}`} 
                  alt={a.nome_file} 
                  style={{ width: "100%", height: 80, objectFit: "cover", display: "block" }} 
                />
              </a>
            ) : (
              <a href={`${API_BASE}${a.url}`} target="_blank" rel="noopener noreferrer" 
                 style={{ display: "flex", height: 80, background: "rgba(255,255,255,0.05)", alignItems: "center", justifyContent: "center", fontSize: 20, color: "var(--text-soft)", textDecoration: "none" }}>
                📄
                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: 2, background: "rgba(0,0,0,0.5)", fontSize: 8, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.nome_file}
                </div>
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

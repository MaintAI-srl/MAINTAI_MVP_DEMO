"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";

type Scadenza = {
  id: number;
  asset_id: number;
  asset_nome: string;
  descrizione: string;
  scadenza: string;
  urgenza: "alta" | "media";
};

export default function NotificationPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [scadenze, setScadenze] = useState<Scadenza[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const d = await apiGet<Scadenza[]>("/scadenze/imminenti?days=15");
        setScadenze(d);
      } catch (e) {
        console.error("Errore notifiche", e);
      }
    }
    load();
    const timer = setInterval(load, 60000); // Ricarica ogni minuto
    return () => clearInterval(timer);
  }, []);

  return (
    <div style={{ position: "relative" }}>
      {/* Icona Campanellina */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        style={{ 
          background: "transparent", border: "none", cursor: "pointer", 
          position: "relative", color: scadenze.length > 0 ? "var(--amber)" : "var(--text-muted)",
          display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40
        }}
      >
        <span style={{ fontSize: 22 }}>🔔</span>
        {scadenze.length > 0 && (
          <span style={{ 
            position: "absolute", top: 8, right: 8, background: "#f87171", 
            color: "#fff", fontSize: 9, fontWeight: 800, padding: "2px 5px", 
            borderRadius: "50%", border: "2px solid #0d1829" 
          }}>
            {scadenze.length}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <>
          <div 
            style={{ position: "fixed", inset: 0, zIndex: 999 }} 
            onClick={() => setIsOpen(false)} 
          />
          <div style={{ 
            position: "absolute", top: 48, right: 0, width: 320, 
            background: "#0f172a", border: "1px solid rgba(59,130,246,0.3)", 
            borderRadius: 16, boxShadow: "0 20px 50px rgba(0,0,0,0.6)", zIndex: 1000,
            overflow: "hidden"
          }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.05)", fontWeight: 800, fontSize: 13, color: "#fff" }}>
              NOTIFICHE SCADENZE
            </div>
            <div style={{ maxHeight: 400, overflowY: "auto" }}>
              {scadenze.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "#64748b", fontSize: 12 }}>
                  Nessuna scadenza imminente nei prossimi 15 giorni.
                </div>
              ) : (
                scadenze.map(s => (
                  <div key={s.id} style={{ padding: 16, borderBottom: "1px solid rgba(255,255,255,0.03)", background: s.urgenza === "alta" ? "rgba(248,113,113,0.03)" : "transparent" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: s.urgenza === "alta" ? "#f87171" : "#818cf8", textTransform: "uppercase" }}>
                        {s.asset_nome}
                      </span>
                      <span style={{ fontSize: 10, color: "#94a3b8" }}>{new Date(s.scadenza).toLocaleDateString()}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.4 }}>{s.descrizione}</div>
                  </div>
                ))
              )}
            </div>
            <div style={{ padding: 12, textAlign: "center", background: "rgba(255,255,255,0.02)" }}>
              <button style={{ background: "transparent", border: "none", color: "#94a3b8", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>VEDI TUTTE LE ATTIVITÀ</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

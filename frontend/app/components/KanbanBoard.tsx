"use client";

import { useEffect, useState } from "react";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, useDroppable, useDraggable } from "@dnd-kit/core";
import { apiPatch, apiGet } from "../lib/api";
import { notify } from "@/lib/toast";

type Tecnico = { id: number; nome: string; cognome: string; specializzazione?: string | null };

export type KanbanTicket = {
  id: number;
  titolo: string;
  asset_name: string | null;
  sito_name?: string | null;
  priorita: string;
  fascia_oraria: string;
  stato: string;
  planned_start?: string | null;
  durata_stimata_ore?: number;
  is_manual_plan?: boolean;
};

const COLS = ["Aperto", "Pianificato", "In corso", "Chiuso"] as const;

const COL_COLORS: Record<string, { border: string; header: string; bg: string }> = {
  "Aperto":      { border: "rgba(96,165,250,0.3)",  header: "#60a5fa", bg: "rgba(96,165,250,0.04)"  },
  "Pianificato": { border: "rgba(167,139,250,0.3)", header: "#a78bfa", bg: "rgba(167,139,250,0.04)" },
  "In corso":    { border: "rgba(251,191,36,0.3)",  header: "#fbbf24", bg: "rgba(251,191,36,0.04)"  },
  "Chiuso":      { border: "rgba(52,211,153,0.3)",  header: "#34d399", bg: "rgba(52,211,153,0.04)"  },
};

const PRIO_COLORS: Record<string, string> = {
  alta: "#f87171", media: "#fbbf24", bassa: "#34d399",
};

function KanbanCard({ ticket, isOverlay = false }: { ticket: KanbanTicket; isOverlay?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: ticket.id });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        background: isOverlay ? "var(--bg-elevated)" : "var(--bg-elevated)",
        border: isOverlay ? "2px solid #60a5fa" : "1px solid var(--border)",
        borderRadius: 12,
        padding: "14px",
        cursor: isDragging ? "grabbing" : "grab",
        opacity: isDragging ? 0.25 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxShadow: isOverlay
          ? "0 20px 60px rgba(0,0,0,0.7), 0 0 24px rgba(96,165,250,0.4)"
          : isDragging ? "0 12px 32px rgba(0,0,0,0.4)" : "0 2px 8px rgba(0,0,0,0.1)",
        userSelect: "none",
        touchAction: "none",
        transition: isDragging ? "none" : "box-shadow 0.2s, border-color 0.2s",
        transform: isOverlay ? "rotate(2deg) scale(1.02)" : undefined,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.4 }}>
        {ticket.titolo}
      </div>
      {ticket.asset_name && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ opacity: 0.7 }}>📦</span> {ticket.asset_name}
        </div>
      )}
      {ticket.sito_name && (
        <div style={{ fontSize: 11, color: "#a6f6ff", display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
          <span style={{ opacity: 0.75 }}>Sito</span> {ticket.sito_name}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
        <span style={{
          fontSize: 10, padding: "3px 8px", borderRadius: 6, fontWeight: 700, textTransform: "uppercase",
          color: PRIO_COLORS[ticket.priorita?.toLowerCase()] ?? "var(--text-secondary)",
          background: `${PRIO_COLORS[ticket.priorita?.toLowerCase()] ?? "var(--text-secondary)"}15`,
          border: `1px solid ${PRIO_COLORS[ticket.priorita?.toLowerCase()] ?? "var(--text-secondary)"}30`,
        }}>
          {ticket.priorita}
        </span>
        <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: "var(--border-subtle)", color: "var(--text-muted)", border: "1px solid var(--border-default)", fontWeight: 600 }}>
          {ticket.fascia_oraria}
        </span>
        {ticket.durata_stimata_ore && (
          <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: "rgba(251,191,36,0.1)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)", fontWeight: 600 }}>
            {ticket.durata_stimata_ore}h
          </span>
        )}
        {ticket.planned_start && (
          <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: "rgba(99,102,241,0.1)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.3)", fontWeight: 600 }}>
            📅 {new Date(ticket.planned_start).toLocaleDateString("it-IT", { day: '2-digit', month: 'short' })}
          </span>
        )}
        {ticket.is_manual_plan && ticket.stato === "Pianificato" && (
          <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: "rgba(234,179,8,0.1)", color: "#eab308", border: "1px solid rgba(234,179,8,0.3)", fontWeight: 700 }}>
            ⚡ MANUALE
          </span>
        )}
      </div>
    </div>
  );
}

function KanbanColumn({
  stato,
  tickets,
  totalCount,
  search,
  onSearchChange,
}: {
  stato: string;
  tickets: KanbanTicket[];
  totalCount: number;
  search: string;
  onSearchChange: (s: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stato });
  const colors = COL_COLORS[stato];

  return (
    <div
      ref={setNodeRef}
      style={{
        background: isOver
          ? `color-mix(in srgb, ${colors.bg} 60%, #0f172a)`
          : "var(--bg-card)",
        border: `${isOver ? "2px" : "1px"} solid ${isOver ? colors.header : "var(--border)"}`,
        borderRadius: 16,
        padding: "16px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minHeight: "70vh",
        maxHeight: "70vh",
        overflowY: "auto",
        transition: "background 0.15s, border-color 0.15s, box-shadow 0.15s",
        boxShadow: isOver ? `0 0 32px ${colors.header}44, inset 0 0 20px ${colors.header}11` : "none",
      }}
    >
      {/* Header sticky */}
      <div style={{ position: "sticky", top: 0, background: "inherit", zIndex: 10, paddingBottom: 6, display: "flex", flexDirection: "column", gap: 6 }}>
        {/* Title row */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: colors.header, boxShadow: `0 0 8px ${colors.header}50`, flexShrink: 0 }} />
          <span style={{ fontWeight: 800, fontSize: 13, color: colors.header, textTransform: "uppercase", letterSpacing: "0.5px" }}>{stato}</span>
          <span style={{
            marginLeft: "auto", fontSize: 11, fontWeight: 700,
            color: search && tickets.length < totalCount ? colors.header : "var(--text-muted)",
            background: "rgba(255,255,255,0.07)", padding: "2px 9px", borderRadius: 20,
          }}>
            {tickets.length}{search && tickets.length < totalCount ? `/${totalCount}` : ""}
          </span>
        </div>
        {/* Search input */}
        <input
          type="text"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder={`Filtra…`}
          onClick={e => e.stopPropagation()}
          style={{
            width: "100%", fontSize: 11, padding: "5px 10px",
            background: search ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.025)",
            border: `1px solid ${search ? colors.header + "66" : "rgba(255,255,255,0.08)"}`,
            borderRadius: 6, color: "var(--text-primary)",
            outline: "none", boxSizing: "border-box" as const,
            transition: "border-color 0.15s, background 0.15s",
          }}
        />
      </div>

      {isOver && (
        <div style={{
          fontSize: 12, fontWeight: 700, textAlign: "center",
          color: colors.header, padding: "10px 0",
          border: `2px dashed ${colors.header}88`,
          borderRadius: 10, marginBottom: 4,
          background: `${colors.bg}`,
          animation: "pulse 1s ease-in-out infinite",
        }}>
          ↓ Rilascia qui per {stato.toLowerCase()}
        </div>
      )}
      {tickets.length === 0 && !isOver ? (
        <div style={{ color: "var(--text-disabled)", fontSize: 12, textAlign: "center", padding: "32px 0", fontStyle: "italic", border: "1px dashed var(--border)", borderRadius: 12 }}>
          {search ? `Nessun ticket corrisponde a "${search}"` : `Nessun ticket ${stato.toLowerCase()}`}
        </div>
      ) : (
        tickets.map(t => <KanbanCard key={t.id} ticket={t} />)
      )}
    </div>
  );
}

// Modal date picker + tecnico per pianificazione da Kanban
function KanbanPianificaModal({
  tecnici,
  onConfirm,
  onCancel,
}: {
  tecnici: Tecnico[];
  onConfirm: (date: string, tecnicoId: number | null) => void;
  onCancel: () => void;
}) {
  const getISO = (days: number, hours: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hours, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  };
  const [date, setDate] = useState(getISO(0, 8));
  const [selectedPreset, setSelectedPreset] = useState<string>("Oggi 08:00");
  const [tecnicoId, setTecnicoId] = useState<number | null>(null);

  const presets = [
    { label: "Oggi 08:00", d: 0, h: 8 },
    { label: "Oggi 14:00", d: 0, h: 14 },
    { label: "Domani 08:00", d: 1, h: 8 },
  ];

  function selectPreset(p: { label: string; d: number; h: number }) {
    setDate(getISO(p.d, p.h));
    setSelectedPreset(p.label);
  }

  function handleDateChange(val: string) {
    setDate(val);
    setSelectedPreset(""); // nessun preset attivo se si modifica manualmente
  }

  const canConfirm = !!date && !!tecnicoId;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)" }}>
      <div style={{ background: "var(--surface-2,#111827)", border: "1px solid rgba(167,139,250,0.4)", borderRadius: 22, padding: "36px 32px", width: 440, boxShadow: "0 40px 100px rgba(0,0,0,0.8), 0 0 40px rgba(167,139,250,0.08)" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, justifyContent: "center" }}>
          <div style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.35)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📅</div>
          <div style={{ fontWeight: 900, fontSize: 19, color: "#a78bfa" }}>Pianifica intervento</div>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 28, textAlign: "center" }}>Imposta data e assegna il tecnico responsabile</div>

        {/* Presets rapidi */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8 }}>Accesso rapido</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
          {presets.map(p => {
            const active = selectedPreset === p.label;
            return (
              <button key={p.label} onClick={() => selectPreset(p)} style={{
                fontSize: 10, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, transition: "all 0.15s",
                background: active ? "rgba(167,139,250,0.25)" : "rgba(167,139,250,0.06)",
                color: active ? "#e9d5ff" : "#a78bfa",
                border: active ? "1.5px solid #a78bfa" : "1px solid rgba(167,139,250,0.2)",
                boxShadow: active ? "0 0 12px rgba(167,139,250,0.3)" : "none",
              }}>
                {active ? "✓ " : ""}{p.label}
              </button>
            );
          })}
        </div>

        {/* Data */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8 }}>Data e ora</div>
        <input type="datetime-local" value={date} onChange={e => handleDateChange(e.target.value)}
          style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(167,139,250,0.25)", borderRadius: 10, color: "var(--text-primary)", padding: "12px 16px", fontSize: 14, outline: "none", colorScheme: "dark", boxSizing: "border-box", marginBottom: 24 }} />

        {/* Tecnico — OBBLIGATORIO */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8 }}>
          Assegna tecnico <span style={{ color: "#f87171", fontWeight: 800 }}>*</span>
        </div>
        <select
          value={tecnicoId ?? ""}
          onChange={e => setTecnicoId(e.target.value ? Number(e.target.value) : null)}
          style={{
            width: "100%", background: "rgba(255,255,255,0.04)", borderRadius: 10,
            border: tecnicoId ? "1.5px solid rgba(167,139,250,0.5)" : "1.5px solid rgba(248,113,113,0.4)",
            color: tecnicoId ? "var(--text-primary)" : "var(--text-muted)",
            padding: "12px 16px", fontSize: 14, outline: "none", cursor: "pointer", boxSizing: "border-box", marginBottom: 8,
            boxShadow: tecnicoId ? "0 0 10px rgba(167,139,250,0.15)" : "none",
          }}
        >
          <option value="">— Seleziona tecnico —</option>
          {tecnici.map(t => (
            <option key={t.id} value={t.id}>
              {t.nome} {t.cognome}{t.specializzazione ? ` · ${t.specializzazione}` : ""}
            </option>
          ))}
        </select>
        {!tecnicoId && (
          <div style={{ fontSize: 11, color: "#f87171", marginBottom: 24, display: "flex", alignItems: "center", gap: 5 }}>
            <span>⚠</span> Il tecnico è obbligatorio per pianificare
          </div>
        )}
        {tecnicoId && <div style={{ marginBottom: 24 }} />}

        {/* Azioni */}
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={onCancel}
            style={{ flex: 1, padding: "13px", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border-default)", color: "var(--text-muted)", borderRadius: 12, cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
            Annulla
          </button>
          <button disabled={!canConfirm} onClick={() => canConfirm && onConfirm(date, tecnicoId)}
            style={{ flex: 2, padding: "13px", background: canConfirm ? "linear-gradient(135deg,#a78bfa,#7c3aed)" : "rgba(167,139,250,0.1)", color: canConfirm ? "#fff" : "rgba(167,139,250,0.4)", border: "none", borderRadius: 12, cursor: canConfirm ? "pointer" : "not-allowed", fontWeight: 800, fontSize: 14, boxShadow: canConfirm ? "0 4px 20px rgba(124,58,237,0.4)" : "none", transition: "all 0.2s" }}>
            ✓ Conferma pianificazione
          </button>
        </div>
      </div>
    </div>
  );
}

interface KanbanBoardProps {
  tickets: KanbanTicket[];
  onRefresh: () => void;
}

export default function KanbanBoard({ tickets, onRefresh }: KanbanBoardProps) {
  const [local, setLocal] = useState<KanbanTicket[]>(tickets);
  const [pianificaRequest, setPianificaRequest] = useState<{ ticketId: number; durataOre: number } | null>(null);
  const [activeTicket, setActiveTicket] = useState<KanbanTicket | null>(null);
  const [tecnici, setTecnici] = useState<Tecnico[]>([]);
  const [colSearch, setColSearch] = useState<Record<string, string>>({});

  useEffect(() => { setLocal(tickets); }, [tickets]);
  useEffect(() => {
    apiGet<Tecnico[]>("/tecnici").then(setTecnici).catch(() => {});
  }, []);

  function handleDragStart({ active }: DragStartEvent) {
    const t = local.find(t => t.id === active.id) ?? null;
    setActiveTicket(t);
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveTicket(null);
    if (!over) return;
    const ticketId = Number(active.id);
    const nuovoStato = String(over.id);
    const ticket = local.find(t => t.id === ticketId);
    if (!ticket || ticket.stato === nuovoStato) return;

    // "Pianificato" richiede data — mostra modal prima di procedere
    if (nuovoStato === "Pianificato") {
      setPianificaRequest({ ticketId, durataOre: ticket.durata_stimata_ore || 1 });
      return;
    }

    const prev = local;
    setLocal(l => l.map(t => t.id === ticketId ? { ...t, stato: nuovoStato } : t));

    try {
      const body: Record<string, string | boolean | null> = { stato: nuovoStato };
      if (nuovoStato === "Aperto") body.is_manual_plan = false;
      if (nuovoStato === "In corso") {
        body.asset_stato = "stopped";
        body.execution_start = new Date().toISOString();
      }
      if (nuovoStato === "Chiuso") {
        body.asset_stato = "service";
        body.execution_finish = new Date().toISOString();
      }
      await apiPatch(`/tickets/${ticketId}`, body);
      onRefresh();
    } catch (err) {
      setLocal(prev);
      notify.error(err instanceof Error ? err.message : "Errore nell'aggiornamento stato ticket.");
    }
  }

  async function confirmPianifica(date: string, tecnicoId: number | null) {
    if (!pianificaRequest) return;
    const { ticketId, durataOre } = pianificaRequest;
    setPianificaRequest(null);

    const start = new Date(date).toISOString();
    const end = new Date(new Date(date).getTime() + durataOre * 3600000).toISOString();

    const prev = local;
    setLocal(l => l.map(t => t.id === ticketId ? { ...t, stato: "Pianificato", planned_start: start, is_manual_plan: true } : t));

    try {
      const body: Record<string, string | boolean | number | null> = {
        stato: "Pianificato", planned_start: start, planned_finish: end, is_manual_plan: true,
      };
      if (tecnicoId) body.tecnico_id = tecnicoId;
      await apiPatch(`/tickets/${ticketId}`, body);
      onRefresh();
    } catch (err: any) {
      setLocal(prev);
      notify.error(err?.message || "Errore nella pianificazione del ticket.");
    }
  }

  const byStato: Record<string, KanbanTicket[]> = {
    "Aperto":      local.filter(t => t.stato === "Aperto"),
    "Pianificato": local.filter(t => t.stato === "Pianificato"),
    "In corso":    local.filter(t => t.stato === "In corso"),
    "Chiuso":      local.filter(t => t.stato === "Chiuso"),
  };

  // Applica ricerca per colonna
  const byStatoFiltered: Record<string, KanbanTicket[]> = {};
  for (const stato of COLS) {
    const q = (colSearch[stato] ?? "").toLowerCase().trim();
    const all = byStato[stato];
    byStatoFiltered[stato] = q
      ? all.filter(t =>
          [t.titolo, t.asset_name ?? "", t.sito_name ?? "", t.priorita ?? ""]
            .some(f => f.toLowerCase().includes(q))
        )
      : all;
  }

  return (
    <>
      <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveTicket(null)}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          {COLS.map(stato => (
            <KanbanColumn
              key={stato}
              stato={stato}
              tickets={byStatoFiltered[stato]}
              totalCount={byStato[stato].length}
              search={colSearch[stato] ?? ""}
              onSearchChange={(s) => setColSearch(prev => ({ ...prev, [stato]: s }))}
            />
          ))}
        </div>

        {/* DragOverlay: card floating ad alta visibilità durante il drag */}
        <DragOverlay dropAnimation={null}>
          {activeTicket ? <KanbanCard ticket={activeTicket} isOverlay={true} /> : null}
        </DragOverlay>
      </DndContext>

      {pianificaRequest && (
        <KanbanPianificaModal
          tecnici={tecnici}
          onConfirm={confirmPianifica}
          onCancel={() => setPianificaRequest(null)}
        />
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </>
  );
}

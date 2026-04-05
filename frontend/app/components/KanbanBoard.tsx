"use client";

import { useEffect, useState } from "react";
import { DndContext, DragEndEvent, useDroppable, useDraggable } from "@dnd-kit/core";
import { apiPatch } from "../lib/api";
import { notify } from "@/lib/toast";

export type KanbanTicket = {
  id: number;
  titolo: string;
  asset_name: string | null;
  priorita: string;
  fascia_oraria: string;
  stato: string;
  planned_start?: string | null;
};

const COLS = ["Aperto", "Pianificato", "In corso"] as const;

const COL_COLORS: Record<string, { border: string; header: string; bg: string }> = {
  "Aperto":      { border: "rgba(96,165,250,0.3)",  header: "#60a5fa", bg: "rgba(96,165,250,0.04)"  },
  "Pianificato": { border: "rgba(167,139,250,0.3)", header: "#a78bfa", bg: "rgba(167,139,250,0.04)" },
  "In corso":    { border: "rgba(251,191,36,0.3)",  header: "#fbbf24", bg: "rgba(251,191,36,0.04)"  },
};

const PRIO_COLORS: Record<string, string> = {
  alta: "#f87171", media: "#fbbf24", bassa: "#34d399",
};

function KanbanCard({ ticket }: { ticket: KanbanTicket }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: ticket.id });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "12px 14px",
        cursor: isDragging ? "grabbing" : "grab",
        opacity: isDragging ? 0.5 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        boxShadow: isDragging ? "0 8px 24px rgba(0,0,0,0.3)" : "0 2px 8px rgba(0,0,0,0.1)",
        userSelect: "none",
        touchAction: "none",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.3 }}>
        {ticket.titolo}
      </div>
      {ticket.asset_name && (
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          📦 {ticket.asset_name}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span style={{
          fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 600,
          color: PRIO_COLORS[ticket.priorita?.toLowerCase()] ?? "var(--text-secondary)",
          background: `${PRIO_COLORS[ticket.priorita?.toLowerCase()] ?? "var(--text-secondary)"}20`,
          border: `1px solid ${PRIO_COLORS[ticket.priorita?.toLowerCase()] ?? "var(--text-secondary)"}40`,
        }}>
          {ticket.priorita}
        </span>
        <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "rgba(255,255,255,0.06)", color: "var(--text-muted)", border: "1px solid rgba(255,255,255,0.1)" }}>
          {ticket.fascia_oraria}
        </span>
        {ticket.planned_start && (
          <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "rgba(99,102,241,0.1)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.3)" }}>
            📅 {new Date(ticket.planned_start).toLocaleDateString("it-IT")}
          </span>
        )}
      </div>
    </div>
  );
}

function KanbanColumn({ stato, tickets }: { stato: string; tickets: KanbanTicket[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stato });
  const colors = COL_COLORS[stato];

  return (
    <div
      ref={setNodeRef}
      style={{
        background: isOver ? colors.bg : "var(--bg-card)",
        border: `1px solid ${isOver ? colors.border : "var(--border)"}`,
        borderRadius: 14,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 200,
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: colors.header, display: "inline-block" }} />
        <span style={{ fontWeight: 700, fontSize: 13, color: colors.header }}>{stato}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)", background: "rgba(255,255,255,0.06)", padding: "2px 8px", borderRadius: 10 }}>
          {tickets.length}
        </span>
      </div>
      {tickets.length === 0 ? (
        <div style={{ color: "var(--text-disabled)", fontSize: 12, textAlign: "center", padding: "24px 0" }}>
          Nessun ticket
        </div>
      ) : (
        tickets.map(t => <KanbanCard key={t.id} ticket={t} />)
      )}
    </div>
  );
}

interface KanbanBoardProps {
  tickets: KanbanTicket[];
  onRefresh: () => void;
}

export default function KanbanBoard({ tickets, onRefresh }: KanbanBoardProps) {
  const [local, setLocal] = useState<KanbanTicket[]>(tickets);

  useEffect(() => { setLocal(tickets); }, [tickets]);

  async function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over) return;
    const ticketId = Number(active.id);
    const nuovoStato = String(over.id);
    const ticket = local.find(t => t.id === ticketId);
    if (!ticket || ticket.stato === nuovoStato) return;

    const prev = local;
    setLocal(l => l.map(t => t.id === ticketId ? { ...t, stato: nuovoStato } : t));

    try {
      await apiPatch(`/tickets/${ticketId}`, { stato: nuovoStato });
      onRefresh();
    } catch {
      setLocal(prev);
      notify.error("Errore nell'aggiornamento stato ticket.");
    }
  }

  const byStato: Record<string, KanbanTicket[]> = {
    "Aperto": local.filter(t => t.stato === "Aperto"),
    "Pianificato": local.filter(t => t.stato === "Pianificato"),
    "In corso": local.filter(t => t.stato === "In corso"),
  };

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {COLS.map(stato => (
          <KanbanColumn key={stato} stato={stato} tickets={byStato[stato]} />
        ))}
      </div>
    </DndContext>
  );
}

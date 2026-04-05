"use client";

import { useEffect, useState, useMemo } from "react";
import { apiGet, apiPost } from "../lib/api";
import { notify } from "@/lib/toast";

import { UnifiedTicket, BacklogStats } from "./unified_types";
import { toIso, addDays, parseStartHour, parseEndHour, woTypeColor } from "./unified_helpers";
import { BlockList, GanttBlock } from "./DashboardComponents";

export default function SchedulerMasterPage() {
  const [mode, setMode] = useState<"MANUALE" | "AI">("MANUALE");
  const [loading, setLoading] = useState(false);
  const [baseDate, setBaseDate] = useState<Date>(new Date());
  const baseDateStr = toIso(baseDate);

  // Manual State
  const [manualData, setManualData] = useState<any>(null);
  // AI State
  const [aiData, setAiData] = useState<any>(null);
  
  // Shared lookups
  const [tecnici, setTecnici] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [ticketsMeta, setTicketsMeta] = useState<any[]>([]);

  useEffect(() => {
    async function loadMeta() {
      try {
        const [tecRes, astRes, tixRes] = await Promise.allSettled([
          apiGet<any[]>("/tecnici"),
          apiGet<any>("/assets?limit=500"),
          apiGet<any>("/tickets?limit=500"),
        ]);
        if (tecRes.status === "fulfilled") setTecnici(Array.isArray(tecRes.value) ? tecRes.value : []);
        if (astRes.status === "fulfilled") setAssets(Array.isArray(astRes.value) ? astRes.value : astRes.value.items || []);
        if (tixRes.status === "fulfilled") setTicketsMeta(Array.isArray(tixRes.value) ? tixRes.value : tixRes.value.items || []);
      } catch (e) {}
    }
    loadMeta();
  }, []);

  const loadManual = async () => {
    setLoading(true);
    try {
      const d = await apiGet(`/scheduler/gantt?start_date=${baseDateStr}`);
      setManualData(d);
    } catch (e) {
    } finally {
      setLoading(false);
    }
  };

  const loadAI = async () => {
    setLoading(true);
    try {
      const current = await apiGet(`/planning/current`);
      setAiData(current);
    } catch (e) {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mode === "MANUALE") {
       loadManual();
    } else {
       if (!aiData) loadAI(); // load AI only if not already loaded to avoid looping
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, baseDateStr]);

  const handleGenerateAI = async () => {
     setLoading(true);
     try {
        const result = await apiPost("/planning/generate", { days: 7 });
        setAiData(result);
        notify.success("Piano AI Generato");
     } catch(e: any) {
        notify.error("Errore AI: " + e.message);
     } finally {
        setLoading(false);
     }
  };

  // Convert data to UnifiedTicket format
  const tixMap = useMemo(() => Object.fromEntries(ticketsMeta.map(t => [t.id, t])), [ticketsMeta]);
  const astMap = useMemo(() => Object.fromEntries(assets.map(a => [a.id, a])), [assets]);
  const tecMap = useMemo(() => Object.fromEntries(tecnici.map(t => [t.id, t])), [tecnici]);

  const { unifiedList, nonAllocati, efficiency, backlogStats } = useMemo(() => {
     let list: UnifiedTicket[] = [];
     let unalloc: UnifiedTicket[] = [];
     let eff: any = null;
     let bs: BacklogStats = { pm_percent: 0, cm_percent: 0, bd_percent: 0 };

     if (mode === "MANUALE" && manualData) {
        const mapManual = (s: any, isAlloc: boolean): UnifiedTicket => ({
           id: s.id, title: s.titolo, asset: s.asset_name || "—",
           type: s.tipo, priority: s.priorita, technicianId: s.tecnico_id,
           technicianName: s.tecnico || "—", date: s.date,
           startHour: s.start_hour, endHour: s.end_hour, durationHours: s.durata_ore,
           isAI: false
        });
        list = (manualData.items || []).map((i:any) => mapManual(i, true));
        unalloc = (manualData.non_allocati || []).map((i:any) => mapManual(i, false));

        const totalU = unalloc.length || 1; // avoid div 0
        const pm = unalloc.filter(t => t.type?.toUpperCase().includes("PM")).length;
        const cm = unalloc.filter(t => t.type?.toUpperCase().includes("CM")).length;
        const bd = unalloc.filter(t => t.type?.toUpperCase().includes("BD")).length;
        bs = { pm_percent: Math.round((pm/totalU)*100), cm_percent: Math.round((cm/totalU)*100), bd_percent: Math.round((bd/totalU)*100) };
     } 
     else if (mode === "AI") {
        if (aiData && aiData.plan_json) {
           const mapAI = (w: any): UnifiedTicket => {
              const tMeta = tixMap[w.wo_id] || {};
              const aMeta = astMap[tMeta.asset_id || 0] || {};
              const tTec  = tecMap[w.technician_id];
              return {
                 id: w.wo_id, title: tMeta.titolo || "Work Order AI", asset: aMeta.nome || w.asset_name || "—",
                 type: w.wo_type || tMeta.tipo || "CM", priority: tMeta.priorita || "-",
                 technicianId: w.technician_id, technicianName: tTec ? `${tTec.nome} ${tTec.cognome||""}`.trim() : "—",
                 date: w.planned_date, startHour: parseStartHour(w.planned_start_time, w.time_slot), endHour: parseEndHour(w.planned_end_time, w.planned_start_time, w.duration_hours, w.time_slot), durationHours: w.duration_hours,
                 isAI: true, warnings: w.warnings, isContinuation: w.is_continuation
              };
           };
           list = (aiData.plan_json.planned_workorders || []).map(mapAI);
           unalloc = (aiData.plan_json.deferred_workorders || []).map((w:any) => ({
              id: w.wo_id, title: tixMap[w.wo_id]?.titolo || "Rimandato", asset: w.asset_name || "—", type: w.type || "-", priority: "-", technicianId: null, technicianName: "—", date: null, startHour: null, endHour: null, durationHours: 0, isAI: true, warnings: [w.reason]
           }));
           eff = { score: aiData.plan_json.efficiency_score || 0, breakdown: aiData.plan_json.efficiency_breakdown || {} };
        }
        // AI Backlog is calculated ideally from the remaining unallocated or the total DB backlog.
        // We will mock the AI Backlog stats for now using unalloc as well if we don't have global stats.
        const totalU = unalloc.length || 1;
        const pm = unalloc.filter(t => t.type?.toUpperCase().includes("PM")).length;
        const cm = unalloc.filter(t => t.type?.toUpperCase().includes("CM")).length;
        const bd = unalloc.filter(t => t.type?.toUpperCase().includes("BD")).length;
        bs = { pm_percent: Math.round((pm/totalU)*100), cm_percent: Math.round((cm/totalU)*100), bd_percent: Math.round((bd/totalU)*100) };
     }

     return { unifiedList: list, nonAllocati: unalloc, efficiency: eff, backlogStats: bs };
  }, [mode, manualData, aiData, tixMap, astMap, tecMap]);

  // Derived lists for blocks
  const [dailyPage, setDailyPage] = useState(0); 
  const [weeklyPage, setWeeklyPage] = useState(0); 
  const [monthlyPage, setMonthlyPage] = useState(0); 
  
  const dailyDateStr = toIso(addDays(baseDate, dailyPage));
  const dailyTickets = unifiedList.filter(t => t.date === dailyDateStr);

  const weeklyStart = addDays(baseDate, Math.floor(weeklyPage / 7) * 7);
  const weeklyEnd = addDays(weeklyStart, 6);
  const weeklyTickets = unifiedList.filter(t => {
     if (!t.date) return false;
     const d = new Date(t.date); return d >= weeklyStart && d <= weeklyEnd;
  });

  const monthlyStart = addDays(baseDate, Math.floor(monthlyPage / 30) * 30);
  const monthlyEnd = addDays(monthlyStart, 29);
  const monthlyTickets = unifiedList.filter(t => {
     if (!t.date) return false;
     const d = new Date(t.date); return d >= monthlyStart && d <= monthlyEnd;
  });

  // Styles
  const gridLine = "1px solid rgba(148,163,184,0.3)";
  const boxStyle = { border: gridLine, background: "var(--bg-card)", display: "flex", flexDirection: "column" as const, minHeight: "150px" };
  const headerStyle = { borderBottom: gridLine, padding: "8px", fontWeight: "bold" as const, fontSize: "12px", textTransform: "uppercase" as const, background: "rgba(148,163,184,0.05)" };

  return (
    <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: "10px", width: "100%", height: "100%", overflowY: "auto", fontFamily: "sans-serif" }}>
      
      {/* HEADER ROW */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
        
        {/* BACKLOG STATUS */}
        <div style={boxStyle}>
          <div style={headerStyle}>BACKLOG STATUS</div>
          <div style={{ padding: "10px", flex: 1, display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
             <div style={{ display: "flex", justifyContent: "space-between" }}><span>PM</span><span style={{ fontWeight: "bold" }}>{backlogStats.pm_percent}%</span></div>
             <div style={{ display: "flex", justifyContent: "space-between" }}><span>CM</span><span style={{ fontWeight: "bold" }}>{backlogStats.cm_percent}%</span></div>
             <div style={{ display: "flex", justifyContent: "space-between" }}><span>BD</span><span style={{ fontWeight: "bold" }}>{backlogStats.bd_percent}%</span></div>
          </div>
        </div>

        {/* PULSANTE SCELTA GENERATIVA */}
        <div style={{ ...boxStyle, alignItems: "center", justifyContent: "center", gap: "20px" }}>
          <div style={{ fontSize: "14px", fontWeight: "bold", textTransform: "uppercase" }}>Pulsante Scelta Generativa</div>
          <div style={{ display: "flex", border: gridLine, borderRadius: "6px", overflow: "hidden" }}>
             <button onClick={() => setMode("MANUALE")} style={{ padding: "10px 20px", border: "none", cursor: "pointer", fontWeight: "bold", background: mode === "MANUALE" ? "#3b82f6" : "transparent", color: mode === "MANUALE" ? "#fff" : "var(--text-primary)" }}>MANUALE</button>
             <button onClick={() => setMode("AI")} style={{ padding: "10px 20px", border: "none", borderLeft: gridLine, cursor: "pointer", fontWeight: "bold", background: mode === "AI" ? "#10b981" : "transparent", color: mode === "AI" ? "#fff" : "var(--text-primary)" }}>AI</button>
          </div>
          {mode === "AI" && (
            <button onClick={handleGenerateAI} disabled={loading} style={{ padding: "8px 16px", borderRadius: "6px", border: "none", background: "#10b981", color: "#fff", fontWeight: "bold", cursor: loading ? "not-allowed" : "pointer" }}>
               {loading ? "Generazione..." : "Rigenera Piano"}
            </button>
          )}
        </div>

        {/* EFFICIENZA PIANO */}
        <div style={boxStyle}>
          <div style={headerStyle}>EFFICIENZA PIANO</div>
          <div style={{ padding: "10px", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
             {mode === "AI" && efficiency ? (
                 <>
                    <div style={{ fontSize: "36px", fontWeight: "bold", color: efficiency.score >= 85 ? "#10b981" : "#f59e0b" }}>{efficiency.score}%</div>
                    {Object.entries(efficiency.breakdown || {}).slice(0,3).map(([key, val]: any) => (
                       <div key={key} style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "4px" }}>{key.replace(/_/g, ' ')}: {val}%</div>
                    ))}
                 </>
             ) : (
                 <div style={{ color: "var(--text-muted)", fontSize: "12px", fontStyle: "italic" }}>Disponibile solo in modalità AI</div>
             )}
          </div>
        </div>

      </div>

      {loading && <div style={{ textAlign: "center", padding: "10px", color: "#3b82f6", fontWeight: "bold" }}>Caricamento dati in corso...</div>}

      {/* GANTT ROUTE */}
      <GanttBlock 
        tickets={unifiedList} 
        dateStr={dailyDateStr} 
        onDateChange={setDailyPage} 
      />

      {/* PIANO GIORNALIERO */}
      <BlockList 
         title={`PIANO GIORNALIERO: ${new Date(dailyDateStr).toLocaleDateString("it-IT")}`} 
         tickets={dailyTickets} 
         pageSize={8} 
      />

      {/* PIANO SETTIMANALE & MENSILE */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        <BlockList 
           title={`PIANO SETTIMANALE: ${weeklyStart.toLocaleDateString("it-IT")} - ${weeklyEnd.toLocaleDateString("it-IT")}`} 
           tickets={weeklyTickets} 
           pageSize={6} 
        />
        <BlockList 
           title={`PIANO MENSILE: ${monthlyStart.toLocaleDateString("it-IT")} - ${monthlyEnd.toLocaleDateString("it-IT")}`} 
           tickets={monthlyTickets} 
           pageSize={6} 
        />
      </div>

      {/* NON PIANIFICATE */}
      <BlockList 
         title="NON PIANIFICATE" 
         tickets={nonAllocati} 
         pageSize={10} 
      />

    </div>
  );
}

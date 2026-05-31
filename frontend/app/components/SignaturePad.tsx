"use client";

import { useRef, useState, useEffect, useCallback } from "react";

type Props = {
  onSave: (base64: string) => void;
  onCancel: () => void;
};

export default function SignaturePad({ onSave, onCancel }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn,  setHasDrawn]  = useState(false);

  /**
   * Inizializza il canvas con la risoluzione reale del device (DPR-aware).
   * Richiamato all'mount e su clear.
   */
  const initCanvas = useCallback(() => {
    const canvas  = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const dpr = window.devicePixelRatio || 1;
    const w   = wrapper.clientWidth;
    const h   = wrapper.clientHeight;

    // Imposta il buffer fisico del canvas = pixel CSS × DPR
    canvas.width  = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    const ctx = canvas.getContext("2d")!;
    // Scala il contesto: ora possiamo disegnare in coordinate CSS e
    // il canvas gestisce internamente la moltiplicazione per DPR
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";
  }, []);

  // Aspetta che il layout sia completato prima di inizializzare
  useEffect(() => {
    const t = setTimeout(initCanvas, 30);
    return () => clearTimeout(t);
  }, [initCanvas]);

  /**
   * Restituisce coordinate CSS relative al canvas element.
   * Funziona correttamente sia su mouse che su touch.
   */
  type PointerEvent = React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>;

  const getPos = (e: PointerEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect    = canvas.getBoundingClientRect();
    const touch = "touches" in e ? e.touches[0] : null;
    const clientX = touch ? touch.clientX : (e as React.MouseEvent).clientX;
    const clientY = touch ? touch.clientY : (e as React.MouseEvent).clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const startDrawing = (e: PointerEvent) => {
    e.preventDefault();
    const { x, y } = getPos(e);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) { ctx.beginPath(); ctx.moveTo(x, y); setIsDrawing(true); }
  };

  const draw = (e: PointerEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const { x, y } = getPos(e);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) { ctx.lineTo(x, y); ctx.stroke(); setHasDrawn(true); }
  };

  const stopDrawing = () => setIsDrawing(false);

  const clear = () => {
    setHasDrawn(false);
    initCanvas(); // reinizializza = pulisce + ristabilisce ctx
  };

  const handleSave = () => {
    if (!hasDrawn) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    onSave(canvas.toDataURL("image/png"));
  };

  return (
    <div style={{
      padding: 16, background: "var(--surface-2)", borderRadius: 16,
      border: "1px solid var(--border-default)",
    }}>
      <div style={{
        fontSize: 12, color: "var(--text-muted)", marginBottom: 10,
        textAlign: "center", fontWeight: 700, letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}>
        ✍️ Firma tecnico per accettazione
      </div>

      {/* Area firma — altezza fissa in CSS, width 100% */}
      <div
        ref={wrapperRef}
        style={{
          width: "100%", height: 160,
          borderRadius: 10, overflow: "hidden",
          background: "rgba(0,0,0,0.45)",
          border: hasDrawn
            ? "1px solid rgba(99,102,241,0.55)"
            : "1px dashed rgba(255,255,255,0.18)",
          transition: "border-color 0.2s",
          position: "relative",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair", touchAction: "none" }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        {!hasDrawn && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            alignItems: "center", justifyContent: "center",
            fontSize: 13, color: "rgba(148,163,184,0.4)", pointerEvents: "none",
            fontWeight: 500,
          }}>
            Firma qui
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button
          onClick={clear}
          style={{
            flex: 1, padding: "12px 0",
            background: "transparent", border: "1px solid var(--border-default)",
            color: "var(--text-muted)", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}
        >
          PULISCI
        </button>
        <button
          onClick={onCancel}
          style={{
            flex: 1, padding: "12px 0",
            background: "transparent", border: "1px solid var(--border-default)",
            color: "var(--text-muted)", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}
        >
          ANNULLA
        </button>
        <button
          onClick={handleSave}
          disabled={!hasDrawn}
          style={{
            flex: 2, padding: "12px 0",
            background: hasDrawn ? "linear-gradient(135deg,#6366f1,#4f46e5)" : "rgba(99,102,241,0.15)",
            border: hasDrawn ? "none" : "1px solid rgba(99,102,241,0.25)",
            color: hasDrawn ? "#fff" : "#6366f1",
            borderRadius: 10, fontSize: 12, fontWeight: 800,
            cursor: hasDrawn ? "pointer" : "not-allowed",
            transition: "all 0.2s",
          }}
        >
          {hasDrawn ? "✓ CONFERMA" : "FIRMA RICHIESTA"}
        </button>
      </div>
    </div>
  );
}

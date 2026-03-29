"use client";

import { useRef, useState, useEffect } from "react";

type Props = {
  onSave: (base64: string) => void;
  onCancel: () => void;
};

export default function SignaturePad({ onSave, onCancel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
  }, []);

  const getPos = (e: any) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const startDrawing = (e: any) => {
    const { x, y } = getPos(e);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      setIsDrawing(true);
    }
  };

  const draw = (e: any) => {
    if (!isDrawing) return;
    const { x, y } = getPos(e);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    if (e.cancelable) e.preventDefault();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const dataUrl = canvas.toDataURL("image/png");
      onSave(dataUrl);
    }
  };

  return (
    <div style={{ padding: 16, background: "#0f172a", borderRadius: 16, border: "1px solid rgba(255,255,255,0.1)" }}>
      <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 12, textAlign: "center", fontWeight: 600 }}>FIRMA TECNICO PER ACCETTAZIONE</div>
      
      <canvas
        ref={canvasRef}
        width={300}
        height={150}
        style={{ width: "100%", height: 150, background: "rgba(0,0,0,0.3)", borderRadius: 8, cursor: "crosshair", touchAction: "none" }}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
      />

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button onClick={clear} style={{ flex: 1, padding: "10px", background: "transparent", border: "1px solid #4b5563", color: "#94a3b8", borderRadius: 8, fontSize: 12, fontWeight: 700 }}>PULISCI</button>
        <button onClick={onCancel} style={{ flex: 1, padding: "10px", background: "transparent", border: "1px solid #4b5563", color: "#94a3b8", borderRadius: 8, fontSize: 12, fontWeight: 700 }}>ANNULLA</button>
        <button onClick={handleSave} style={{ flex: 2, padding: "10px", background: "linear-gradient(135deg,#6366f1,#4f46e5)", border: "none", color: "#fff", borderRadius: 8, fontSize: 12, fontWeight: 800 }}>CONFERMA FIRMA</button>
      </div>
    </div>
  );
}

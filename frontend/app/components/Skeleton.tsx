/**
 * Skeleton — Componente placeholder animato per stati di caricamento.
 *
 * Mostra blocchi pulsanti con le dimensioni specificate, migliorando la percezione
 * di velocità della piattaforma. Compatibile dark/light mode via CSS variables.
 *
 * Uso:
 *   <Skeleton width="100%" height={20} />
 *   <Skeleton variant="text" lines={3} />
 *   <Skeleton variant="card" />
 *   <Skeleton variant="table" rows={5} />
 */
"use client";

import React from "react";

// ── Stile base ───────────────────────────────────────────────────────────────
const pulseKeyframes = `
@keyframes skeletonPulse {
  0%   { opacity: 0.4; }
  50%  { opacity: 0.7; }
  100% { opacity: 0.4; }
}
`;

const baseStyle: React.CSSProperties = {
  background: "var(--border, rgba(148,163,184,0.15))",
  borderRadius: 6,
  animation: "skeletonPulse 1.5s ease-in-out infinite",
};

// ── Block Skeleton ───────────────────────────────────────────────────────────
function SkeletonBlock({
  width = "100%",
  height = 16,
  borderRadius,
  style,
}: {
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        ...baseStyle,
        width,
        height,
        ...(borderRadius !== undefined ? { borderRadius } : {}),
        ...style,
      }}
    />
  );
}

// ── Text Lines Skeleton ──────────────────────────────────────────────────────
function SkeletonText({ lines = 3, gap = 10 }: { lines?: number; gap?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock
          key={i}
          height={14}
          width={i === lines - 1 ? "70%" : "100%"}
        />
      ))}
    </div>
  );
}

// ── Card Skeleton ────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div
      style={{
        background: "var(--bg-card, var(--surface-2))",
        border: "1px solid var(--border, rgba(148,163,184,0.15))",
        borderRadius: "var(--radius-lg, 12px)",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <SkeletonBlock width={120} height={12} />
        <SkeletonBlock width={60} height={12} />
      </div>
      <SkeletonBlock height={20} width="80%" />
      <SkeletonText lines={2} />
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <SkeletonBlock width={80} height={28} borderRadius={14} />
        <SkeletonBlock width={80} height={28} borderRadius={14} />
      </div>
    </div>
  );
}

// ── Table Row Skeleton ───────────────────────────────────────────────────────
function SkeletonTableRow({ cols = 5 }: { cols?: number }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 12,
        padding: "12px 16px",
        borderBottom: "1px solid var(--border, rgba(148,163,184,0.08))",
      }}
    >
      {Array.from({ length: cols }).map((_, i) => (
        <SkeletonBlock
          key={i}
          height={14}
          width={i === 0 ? "60%" : i === cols - 1 ? "40%" : "80%"}
        />
      ))}
    </div>
  );
}

function SkeletonTable({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div
      style={{
        background: "var(--bg-card, var(--surface-2))",
        border: "1px solid var(--border, rgba(148,163,184,0.15))",
        borderRadius: "var(--radius-lg, 12px)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 12,
          padding: "14px 16px",
          borderBottom: "1px solid var(--border, rgba(148,163,184,0.15))",
          background: "rgba(0,0,0,0.1)",
        }}
      >
        {Array.from({ length: cols }).map((_, i) => (
          <SkeletonBlock key={i} height={10} width="50%" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonTableRow key={i} cols={cols} />
      ))}
    </div>
  );
}

// ── Stat Cards Skeleton ──────────────────────────────────────────────────────
function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(200px, 1fr))`, gap: 16 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            background: "var(--bg-card, var(--surface-2))",
            border: "1px solid var(--border, rgba(148,163,184,0.15))",
            borderRadius: "var(--radius-lg, 12px)",
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <SkeletonBlock width={80} height={10} />
          <SkeletonBlock width={60} height={28} />
          <SkeletonBlock width="100%" height={6} borderRadius={3} />
        </div>
      ))}
    </div>
  );
}

// ── Export componenti ─────────────────────────────────────────────────────────
export default function Skeleton({
  variant = "block",
  width,
  height,
  lines,
  rows,
  cols,
  count,
  style,
}: {
  variant?: "block" | "text" | "card" | "table" | "stats";
  width?: number | string;
  height?: number | string;
  lines?: number;
  rows?: number;
  cols?: number;
  count?: number;
  style?: React.CSSProperties;
}) {
  return (
    <>
      <style>{pulseKeyframes}</style>
      {variant === "text" && <SkeletonText lines={lines} />}
      {variant === "card" && <SkeletonCard />}
      {variant === "table" && <SkeletonTable rows={rows} cols={cols} />}
      {variant === "stats" && <SkeletonStats count={count} />}
      {variant === "block" && <SkeletonBlock width={width} height={height} style={style} />}
    </>
  );
}

// Export named per uso diretto
export { SkeletonBlock, SkeletonText, SkeletonCard, SkeletonTable, SkeletonStats, SkeletonTableRow };

"use client";

import { useState } from "react";

type Option = {
  value: string;
  label: string;
  color: string;
};

type StatusToggleProps = {
  options: Option[];
  currentValue: string;
  onChange: (value: string) => Promise<void> | void;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
};

export default function StatusToggle({ options, currentValue, onChange, disabled, size = "md" }: StatusToggleProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async (val: string) => {
    if (val === currentValue || disabled || loading) return;
    setLoading(true);
    try {
      await onChange(val);
    } finally {
      setLoading(false);
    }
  };

  const paddings = size === "sm" ? "4px 8px" : size === "lg" ? "10px 20px" : "6px 14px";
  const fontSize = size === "sm" ? "10px" : size === "lg" ? "14px" : "12px";

  return (
    <div style={{ 
      display: "inline-flex", 
      gap: "4px", 
      background: "rgba(0,0,0,0.2)", 
      padding: "4px", 
      borderRadius: "10px", 
      border: "1px solid var(--border)",
      opacity: disabled || loading ? 0.6 : 1,
      pointerEvents: disabled || loading ? "none" : "auto",
      transition: "opacity 0.2s"
    }}>
      {options.map((opt) => {
        const active = opt.value === currentValue;
        return (
          <button
            key={opt.value}
            onClick={() => handleClick(opt.value)}
            style={{
              padding: paddings,
              fontSize: fontSize,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              cursor: "pointer",
              border: "none",
              borderRadius: "7px",
              background: active ? opt.color : "transparent",
              color: active ? "#000" : "var(--text-secondary)",
              opacity: active ? 1 : 0.4,
              transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: size === "sm" ? "0" : "80px",
              boxShadow: active ? `0 0 15px ${opt.color}44` : "none",
            }}
          >
            {active && loading && (
              <span className="status-spinner" style={{ marginRight: "6px" }} />
            )}
            {opt.label}
          </button>
        );
      })}
      
      <style jsx>{`
        .status-spinner {
          width: 10px;
          height: 10px;
          border: 2px solid rgba(0,0,0,0.3);
          border-top: 2px solid #000;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

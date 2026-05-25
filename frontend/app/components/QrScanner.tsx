"use client";

import { useEffect, useRef, useState } from "react";

interface QrScannerProps {
  onScan: (value: string) => void;
  onCancel: () => void;
  title?: string;
  subtitle?: string;
}

// Web API — BarcodeDetector (Chrome/Edge 83+, Safari 17.1+, Android WebView 83+)
interface BarcodeDetectorResult { rawValue: string; format: string; }
interface BarcodeDetectorInstance {
  detect(image: HTMLVideoElement): Promise<BarcodeDetectorResult[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorInstance;
  }
}

export default function QrScanner({
  onScan,
  onCancel,
  title = "Scansiona QR",
  subtitle = "Inquadra il QR code dell'asset",
}: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const scannedRef = useRef(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [hasDetector] = useState(() => typeof window !== "undefined" && !!window.BarcodeDetector);
  const [manualCode, setManualCode] = useState("");

  function stopCamera() {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    if (!hasDetector) return;

    let detector: BarcodeDetectorInstance;
    try {
      detector = new window.BarcodeDetector!({ formats: ["qr_code"] });
    } catch {
      return;
    }

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      })
      .then((stream) => {
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) { stopCamera(); return; }
        video.srcObject = stream;
        video.play().catch(() => {});

        const tick = async () => {
          if (scannedRef.current) return;
          if (video.readyState >= 2) {
            try {
              const codes = await detector.detect(video);
              if (codes.length > 0 && !scannedRef.current) {
                scannedRef.current = true;
                stopCamera();
                onScan(codes[0].rawValue);
                return;
              }
            } catch {
              /* ignore decode errors */
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch((err: Error) => {
        setCameraError("Fotocamera non disponibile: " + (err.message ?? "Permesso negato"));
      });

    return () => stopCamera();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleCancel() {
    stopCamera();
    onCancel();
  }

  function handleManualSubmit() {
    const v = manualCode.trim();
    if (!v) return;
    stopCamera();
    onScan(v);
  }

  const CORNERS = ["tl", "tr", "bl", "br"] as const;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#000",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Camera feed */}
      {hasDetector && !cameraError && (
        <video
          ref={videoRef}
          playsInline
          muted
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}

      {/* Viewfinder overlay */}
      {hasDetector && !cameraError && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          {/* Dark surround (4 panels) */}
          <div style={{ position: "absolute", inset: 0 }}>
            {/* top */}
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "calc(50% - 120px)", background: "rgba(0,0,0,0.65)" }} />
            {/* bottom */}
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "calc(50% - 120px)", background: "rgba(0,0,0,0.65)" }} />
            {/* left */}
            <div style={{ position: "absolute", top: "calc(50% - 120px)", left: 0, width: "calc(50% - 120px)", height: 240, background: "rgba(0,0,0,0.65)" }} />
            {/* right */}
            <div style={{ position: "absolute", top: "calc(50% - 120px)", right: 0, width: "calc(50% - 120px)", height: 240, background: "rgba(0,0,0,0.65)" }} />
          </div>

          {/* Corner markers */}
          <div style={{ position: "relative", width: 240, height: 240 }}>
            {CORNERS.map((c) => (
              <div
                key={c}
                style={{
                  position: "absolute",
                  width: 32,
                  height: 32,
                  ...(c.startsWith("t") ? { top: 0 } : { bottom: 0 }),
                  ...(c.endsWith("l") ? { left: 0 } : { right: 0 }),
                  borderTop: c.startsWith("t") ? "3px solid #22c55e" : "none",
                  borderBottom: c.startsWith("b") ? "3px solid #22c55e" : "none",
                  borderLeft: c.endsWith("l") ? "3px solid #22c55e" : "none",
                  borderRight: c.endsWith("r") ? "3px solid #22c55e" : "none",
                  borderTopLeftRadius: c === "tl" ? 8 : 0,
                  borderTopRightRadius: c === "tr" ? 8 : 0,
                  borderBottomLeftRadius: c === "bl" ? 8 : 0,
                  borderBottomRightRadius: c === "br" ? 8 : 0,
                }}
              />
            ))}
          </div>

          {/* Subtitle */}
          <div
            style={{
              position: "absolute",
              bottom: "calc(50% - 148px)",
              left: 0,
              right: 0,
              textAlign: "center",
            }}
          >
            <div
              style={{
                display: "inline-block",
                background: "rgba(0,0,0,0.55)",
                backdropFilter: "blur(6px)",
                borderRadius: 20,
                padding: "7px 18px",
                color: "rgba(255,255,255,0.75)",
                fontSize: 13,
              }}
            >
              {subtitle}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)",
        }}
      >
        <button
          onClick={handleCancel}
          style={{
            background: "rgba(255,255,255,0.15)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.2)",
            color: "#fff",
            borderRadius: 8,
            padding: "8px 14px",
            fontSize: 14,
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          ← Annulla
        </button>
        <span
          style={{
            fontWeight: 800,
            fontSize: 16,
            color: "#fff",
            textShadow: "0 1px 6px rgba(0,0,0,0.6)",
          }}
        >
          {title}
        </span>
      </div>

      {/* Error / No detector fallback */}
      {(cameraError || !hasDetector) && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px 20px",
            gap: 16,
          }}
        >
          <div style={{ fontSize: 48 }}>📷</div>
          {cameraError && (
            <div
              style={{
                color: "#f87171",
                fontSize: 14,
                textAlign: "center",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 12,
                padding: "12px 16px",
              }}
            >
              ⚠️ {cameraError}
            </div>
          )}
          {!hasDetector && (
            <div style={{ color: "#94a3b8", fontSize: 14, textAlign: "center" }}>
              Scanner QR non supportato su questo browser.<br />
              Inserisci il codice asset manualmente:
            </div>
          )}
        </div>
      )}

      {/* Manual fallback input (shown when camera unavailable or no BarcodeDetector) */}
      {(cameraError || !hasDetector) && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            background: "#111827",
            borderTop: "1px solid rgba(255,255,255,0.1)",
            padding: "20px",
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.4)",
              marginBottom: 10,
            }}
          >
            Codice asset (dal QR o dall&apos;etichetta):
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleManualSubmit();
              }}
              placeholder="Es. POMPA-001 oppure 42"
              autoFocus
              style={{
                flex: 1,
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 10,
                color: "#fff",
                padding: "12px 14px",
                fontSize: 14,
                outline: "none",
              }}
            />
            <button
              onClick={handleManualSubmit}
              disabled={!manualCode.trim()}
              style={{
                padding: "12px 20px",
                background: manualCode.trim() ? "#3b82f6" : "rgba(255,255,255,0.06)",
                border: "none",
                borderRadius: 10,
                color: manualCode.trim() ? "#fff" : "rgba(255,255,255,0.3)",
                fontWeight: 800,
                cursor: manualCode.trim() ? "pointer" : "not-allowed",
                fontSize: 14,
                transition: "all 0.15s",
              }}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

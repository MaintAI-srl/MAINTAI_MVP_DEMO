"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  onTranscript: (text: string) => void;
  disabled?: boolean;
};

type RecordingState = "idle" | "recording" | "processing";

export default function VoiceRecorder({ onTranscript, disabled }: Props) {
  const [state, setState] = useState<RecordingState>("idle");
  const [error, setError] = useState("");
  const [supported, setSupported] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Controlla se il browser supporta la Web Speech API o MediaRecorder
  useEffect(() => {
    const hasSpeechRecognition =
      typeof window !== "undefined" &&
      ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
    setSupported(hasSpeechRecognition);
  }, []);

  const startRecording = async () => {
    setError("");
    setElapsed(0);

    // Usa Web Speech API (nativa, no server) se disponibile — meglio per mobile
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.lang = "it-IT";
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      let fullText = "";

      recognition.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            fullText += event.results[i][0].transcript + " ";
          }
        }
      };

      recognition.onerror = (event: any) => {
        setError(`Errore riconoscimento: ${event.error}`);
        setState("idle");
        if (timerRef.current) clearInterval(timerRef.current);
      };

      recognition.onend = () => {
        setState("idle");
        if (timerRef.current) clearInterval(timerRef.current);
        if (fullText.trim()) {
          onTranscript(fullText.trim());
        }
      };

      (window as any).__maintaiRecognition = recognition;
      recognition.start();
      setState("recording");

      timerRef.current = setInterval(() => {
        setElapsed(s => s + 1);
      }, 1000);
    } else {
      setError("Il tuo browser non supporta il riconoscimento vocale. Usa Chrome su Android.");
      setSupported(false);
    }
  };

  const stopRecording = () => {
    const recognition = (window as any).__maintaiRecognition;
    if (recognition) {
      recognition.stop();
      delete (window as any).__maintaiRecognition;
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setState("idle");
  };

  useEffect(() => {
    return () => {
      const recognition = (window as any).__maintaiRecognition;
      if (recognition) recognition.stop();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  if (!supported) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button
        type="button"
        onClick={state === "recording" ? stopRecording : startRecording}
        disabled={disabled || state === "processing"}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          height: 52,
          borderRadius: 14,
          border: state === "recording"
            ? "2px solid #ef4444"
            : "2px solid rgba(91,143,255,0.35)",
          background: state === "recording"
            ? "rgba(239,68,68,0.12)"
            : "rgba(91,143,255,0.08)",
          color: state === "recording" ? "#f87171" : "#90b8ff",
          fontWeight: 800,
          fontSize: 14,
          cursor: disabled ? "not-allowed" : "pointer",
          transition: "all 0.2s",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Pulse glow while recording */}
        {state === "recording" && (
          <span
            style={{
              position: "absolute",
              inset: 0,
              background: "radial-gradient(ellipse at 50% 50%, rgba(239,68,68,0.15) 0%, transparent 70%)",
              animation: "voicePulse 1s infinite",
            }}
          />
        )}
        <span style={{ fontSize: 20, zIndex: 1 }}>
          {state === "recording" ? "⏹" : "🎙️"}
        </span>
        <span style={{ zIndex: 1 }}>
          {state === "recording"
            ? `STOP REGISTRAZIONE  ${formatTime(elapsed)}`
            : "🎙️ REGISTRA NOTA VOCALE"}
        </span>
      </button>

      {error && (
        <div style={{ fontSize: 12, color: "#f87171", padding: "4px 8px", background: "rgba(239,68,68,0.08)", borderRadius: 8 }}>
          ⚠️ {error}
        </div>
      )}

      <style>{`
        @keyframes voicePulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, Check } from "lucide-react";

type Props = {
  onTranscript: (text: string) => void;
  disabled?: boolean;
};

type RecordingState = "idle" | "recording" | "processing";

// Messaggi comprensibili per gli errori della Web Speech API
function friendlyRecognitionError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Permesso microfono negato. Consenti l'accesso al microfono dalle impostazioni del browser (icona 🔒 nella barra indirizzi) e riprova.";
    case "no-speech":
      return "Non ho sentito nulla. Avvicina il telefono e riprova.";
    case "audio-capture":
      return "Microfono non disponibile. Verifica che non sia in uso da un'altra app.";
    case "network":
      return "Errore di rete nel riconoscimento vocale. Controlla la connessione e riprova.";
    case "aborted":
      return "";
    default:
      return `Errore riconoscimento vocale (${code}). Riprova.`;
  }
}

export default function VoiceRecorder({ onTranscript, disabled }: Props) {
  const [state, setState] = useState<RecordingState>("idle");
  const [error, setError] = useState("");
  const [supported, setSupported] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [fallbackText, setFallbackText] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Controlla se il browser supporta la Web Speech API
  useEffect(() => {
    const hasSpeechRecognition =
      typeof window !== "undefined" &&
      ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
    // TODO(sec-04): revisione umana - init one-shot da feature detection browser, accettato
    // eslint-disable-next-line react-hooks/set-state-in-effect -- rileva feature browser all'mount; non triggera cascata
    setSupported(hasSpeechRecognition);
  }, []);

  // Tipi minimal per Web Speech API (non inclusa nei lib TypeScript standard)
  type SpeechRecognitionInstance = {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
  };
  type SpeechRecognitionResult = { isFinal: boolean; 0: { transcript: string } };
  type SpeechRecognitionEvent = { resultIndex: number; results: SpeechRecognitionResult[] & { length: number } };
  type WindowWithSpeech = Window & {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    __maintaiRecognition?: SpeechRecognitionInstance;
  };

  // Richiede esplicitamente il permesso microfono PRIMA di avviare il
  // riconoscimento: su molti browser mobili SpeechRecognition fallisce in
  // silenzio se il permesso non è mai stato concesso.
  async function ensureMicPermission(): Promise<boolean> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      // Contesto non sicuro (HTTP) o browser molto vecchio: lascia provare
      // direttamente SpeechRecognition, che mostrerà il proprio prompt.
      if (typeof window !== "undefined" && !window.isSecureContext) {
        setError("Il microfono richiede una connessione sicura (HTTPS).");
        return false;
      }
      return true;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      return true;
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setError("Permesso microfono negato. Consenti l'accesso al microfono dalle impostazioni del browser (icona 🔒 nella barra indirizzi) e riprova.");
      } else if (name === "NotFoundError") {
        setError("Nessun microfono trovato sul dispositivo.");
      } else {
        setError("Impossibile accedere al microfono. Verifica i permessi del browser.");
      }
      return false;
    }
  }

  const startRecording = async () => {
    setError("");
    setElapsed(0);

    const win = window as WindowWithSpeech;
    const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSupported(false);
      return;
    }

    setState("processing");
    const ok = await ensureMicPermission();
    if (!ok) { setState("idle"); return; }

    const recognition = new SpeechRecognition();
    recognition.lang = "it-IT";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    let fullText = "";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          fullText += event.results[i][0].transcript + " ";
        }
      }
    };

    recognition.onerror = (event: { error: string }) => {
      const msg = friendlyRecognitionError(event.error);
      if (msg) setError(msg);
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

    win.__maintaiRecognition = recognition;
    try {
      recognition.start();
    } catch {
      setError("Impossibile avviare il riconoscimento vocale. Riprova.");
      setState("idle");
      return;
    }
    setState("recording");

    timerRef.current = setInterval(() => {
      setElapsed(s => s + 1);
    }, 1000);
  };

  const stopRecording = () => {
    const win = window as WindowWithSpeech;
    const recognition = win.__maintaiRecognition;
    if (recognition) {
      recognition.stop();
      delete win.__maintaiRecognition;
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setState("idle");
  };

  useEffect(() => {
    return () => {
      const win = window as WindowWithSpeech;
      const recognition = win.__maintaiRecognition;
      if (recognition) recognition.stop();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  // Fallback: browser senza Web Speech API (es. Firefox, alcuni Safari) —
  // permette comunque di dettare/scrivere la nota a mano invece di sparire.
  if (!supported) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.5, padding: "4px 2px" }}>
          🎙️ Il riconoscimento vocale non è supportato da questo browser
          (usa Chrome o Safari aggiornato). Puoi scrivere il testo qui sotto
          — con la tastiera o il microfono della tastiera:
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={fallbackText}
            onChange={e => setFallbackText(e.target.value)}
            placeholder="Scrivi o detta qui..."
            disabled={disabled}
            style={{
              flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 12, color: "#fff", padding: "12px 14px", fontSize: 16, outline: "none",
              WebkitAppearance: "none", boxSizing: "border-box", minWidth: 0,
            }}
          />
          <button
            type="button"
            className="m-press"
            disabled={disabled || !fallbackText.trim()}
            onClick={() => { onTranscript(fallbackText.trim()); setFallbackText(""); }}
            style={{
              padding: "0 18px", borderRadius: 12, border: "none", flexShrink: 0,
              background: fallbackText.trim() ? "linear-gradient(135deg,#0A84FF,#0064D2)" : "rgba(255,255,255,0.06)",
              color: fallbackText.trim() ? "#fff" : "rgba(255,255,255,0.25)",
              fontWeight: 800, fontSize: 14, cursor: fallbackText.trim() ? "pointer" : "default",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <Check size={18} strokeWidth={2.6} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
      <button
        type="button"
        className="m-press"
        onClick={state === "recording" ? stopRecording : startRecording}
        disabled={disabled || state === "processing"}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 9,
          height: 56,
          borderRadius: 18,
          border: state === "recording"
            ? "1.5px solid rgba(255,69,58,0.6)"
            : "1.5px solid rgba(10,132,255,0.4)",
          background: state === "recording"
            ? "rgba(255,69,58,0.13)"
            : "rgba(10,132,255,0.10)",
          color: state === "recording" ? "#FF6961" : "#6CB4FF",
          fontWeight: 800,
          fontSize: 14,
          letterSpacing: "0.04em",
          cursor: disabled ? "not-allowed" : "pointer",
          transition: "background 0.25s, border-color 0.25s, color 0.25s",
          position: "relative",
          overflow: "hidden",
          width: "100%",
        }}
      >
        {/* Pulse glow while recording */}
        {state === "recording" && (
          <span
            style={{
              position: "absolute",
              inset: 0,
              background: "radial-gradient(ellipse at 50% 50%, rgba(255,69,58,0.16) 0%, transparent 70%)",
              animation: "voicePulse 1s infinite",
            }}
          />
        )}
        <span style={{
          zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          width: 30, height: 30, borderRadius: "50%",
          background: state === "recording" ? "rgba(255,69,58,0.22)" : "rgba(10,132,255,0.18)",
        }}>
          {state === "recording"
            ? <Square size={13} strokeWidth={2.4} fill="currentColor" />
            : <Mic size={16} strokeWidth={2.2} />}
        </span>
        <span style={{ zIndex: 1 }}>
          {state === "processing"
            ? "ATTIVAZIONE MICROFONO…"
            : state === "recording"
              ? `STOP  ${formatTime(elapsed)}`
              : "REGISTRA NOTA VOCALE"}
        </span>
      </button>

      {error && (
        <div style={{ fontSize: 12, color: "#f87171", padding: "8px 10px", background: "rgba(239,68,68,0.08)", borderRadius: 10, lineHeight: 1.5 }}>
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

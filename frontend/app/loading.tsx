export default function Loading() {
  return (
    <div style={{
      position: "fixed",
      inset: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "var(--bg-base)", // Same dark color as the app background
      zIndex: 9999
    }}>
      <style>{`
        @keyframes customPulse {
          0% { transform: scale(0.95); opacity: 0.7; }
          50% { transform: scale(1.05); opacity: 1; filter: drop-shadow(0 0 20px rgba(59, 130, 246, 0.5)); }
          100% { transform: scale(0.95); opacity: 0.7; }
        }
      `}</style>
      <img 
        src="/logo.png" 
        alt="MaintAI Logo Caricamento" 
        style={{
          width: "100px",
          height: "100px",
          objectFit: "contain",
          animation: "customPulse 1.5s ease-in-out infinite"
        }} 
      />
      <div style={{ 
        marginTop: "24px", 
        color: "#60a5fa", 
        fontSize: "12px", 
        letterSpacing: "0.2em",
        fontWeight: 600,
        textTransform: "uppercase" 
      }}>
        Inizializzazione...
      </div>
    </div>
  );
}

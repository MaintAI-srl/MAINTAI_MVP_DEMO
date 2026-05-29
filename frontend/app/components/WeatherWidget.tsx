"use client";

import React, { useEffect, useState } from "react";
import { 
  Sun, 
  Cloud, 
  CloudRain, 
  CloudLightning, 
  CloudSnow, 
  CloudSun, 
  CloudDrizzle, 
  CloudFog,
  Navigation,
  Wind,
  Settings,
  X,
  Check,
  Calendar,
  Thermometer,
  Search,
  RefreshCw,
  AlertCircle
} from "lucide-react";

type WeatherData = {
  current: {
    temp: number;
    code: number;
    windspeed: number;
    winddirection: number;
  };
  daily: {
    dates: string[];
    codes: number[];
    maxTemps: number[];
    minTemps: number[];
  };
};

export default function WeatherWidget() {
  const [data, setData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [showForecast, setShowForecast] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  // Stato località persistente
  const [locConfig, setLocConfig] = useState({
    name: "SAVONA",
    lat: 44.307,
    lon: 8.481
  });

  const [editForm, setEditForm] = useState(locConfig);

  useEffect(() => {
    const saved = localStorage.getItem("maintai_weather_loc");
    if (saved) {
      const parsed = JSON.parse(saved);
      setLocConfig(parsed);
      setEditForm(parsed);
    }
  }, []);

  const fetchWeather = async () => {
    setLoading(true);
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${locConfig.lat}&longitude=${locConfig.lon}&current_weather=true&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto&_t=${Date.now()}`;
      const res = await fetch(url);
      const json = await res.json();

      setData({
        current: {
          temp: json.current_weather.temperature,
          code: json.current_weather.weathercode,
          windspeed: json.current_weather.windspeed,
          winddirection: json.current_weather.winddirection,
        },
        daily: {
          dates: json.daily.time,
          codes: json.daily.weathercode,
          maxTemps: json.daily.temperature_2m_max,
          minTemps: json.daily.temperature_2m_min,
        }
      });
      setLastUpdated(new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }));
    } catch (err) {
      console.error("Weather fetch failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const geocodeCity = async () => {
    if (!editForm.name.trim()) return;
    setSearching(true);
    setSearchError("");
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(editForm.name)}&count=1&language=it`;
      const res = await fetch(url);
      const json = await res.json();

      if (json.results && json.results.length > 0) {
        const result = json.results[0];
        setEditForm({
          name: result.name.toUpperCase(),
          lat: result.latitude,
          lon: result.longitude
        });
      } else {
        setSearchError("Città non trovata. Controlla il nome.");
      }
    } catch (err) {
      setSearchError("Errore durante la ricerca.");
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    fetchWeather();
    const interval = setInterval(fetchWeather, 1800000); 
    return () => clearInterval(interval);
  }, [locConfig.lat, locConfig.lon]);

  const saveLocation = () => {
    setLocConfig(editForm);
    localStorage.setItem("maintai_weather_loc", JSON.stringify(editForm));
    setShowSettings(false);
  };

  const getWeatherUI = (code: number, size = 16) => {
    if (code === 0) return { icon: <Sun size={size} />, color: "#fbbf24", shadow: "0 0 10px rgba(251,191,36,0.4)" };
    if ([1, 2, 3].includes(code)) return { icon: <CloudSun size={size} />, color: "#fcd34d", shadow: "0 0 10px rgba(252,211,77,0.3)" };
    if ([45, 48].includes(code)) return { icon: <CloudFog size={size} />, color: "var(--text-muted)", shadow: "0 0 10px rgba(148,163,184,0.3)" };
    if ([51, 53, 55].includes(code)) return { icon: <CloudDrizzle size={size} />, color: "#22d3ee", shadow: "0 0 10px rgba(34,211,238,0.4)" };
    if ([61, 63, 65, 80, 81, 82].includes(code)) return { icon: <CloudRain size={size} />, color: "#3b82f6", shadow: "0 0 10px rgba(59,130,246,0.4)" };
    if ([71, 73, 75, 85, 86].includes(code)) return { icon: <CloudSnow size={size} />, color: "#e0e7ff", shadow: "0 0 10px rgba(224,231,255,0.4)" };
    if ([95, 96, 99].includes(code)) return { icon: <CloudLightning size={size} />, color: "#a78bfa", shadow: "0 0 10px rgba(167,139,250,0.5)" };
    return { icon: <Cloud size={size} />, color: "#cbd5e1", shadow: "none" };
  };

  const getDayName = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("it-IT", { weekday: "short" }).toUpperCase();
  };

  if (loading && !data) {
    return (
      <div style={{ display: "flex", gap: "8px", padding: "0 10px" }}>
        {[1,2,3,4].map(i => <div key={i} style={{ width: 40, height: 24, background: "var(--border-subtle)", borderRadius: 6, animation: "pulse 2s infinite" }} />)}
      </div>
    );
  }

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      
      {/* Container Widget */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "0 10px" }}>
        
        {/* Località Clickable */}
        <div 
          onClick={() => setShowSettings(!showSettings)}
          className="hover-opacity"
          style={{ 
            display: "flex", 
            alignItems: "center", 
            gap: "5px", 
            cursor: "pointer", 
            opacity: 0.8,
            transition: "opacity 0.2s"
          }}
        >
          <Navigation size={10} color="#818cf8" fill="#818cf8" />
          <span style={{ fontSize: "9px", fontWeight: 800, color: "var(--text-muted)", letterSpacing: "0.08em" }}>{locConfig.name}</span>
          <Settings size={9} style={{ opacity: 0.5 }} />
        </div>

        {/* Striscia Orrizzontale */}
        <div 
          style={{ display: "flex", alignItems: "center", gap: "6px" }}
          onMouseEnter={() => setShowForecast(true)}
          onMouseLeave={() => setShowForecast(false)}
        >
          {/* Oggi con Vento */}
          <div style={{ 
            display: "flex", 
            gap: "8px", 
            alignItems: "center", 
            padding: "2px 10px", 
            background: "var(--border-subtle)", 
            borderRadius: "8px",
            border: "1px solid var(--border-default)",
            cursor: "pointer"
          }}>
            <div style={{ filter: `drop-shadow(${getWeatherUI(data?.current.code ?? 0).shadow})`, color: getWeatherUI(data?.current.code ?? 0).color, display: "flex" }}>
              {getWeatherUI(data?.current.code ?? 0, 16).icon}
            </div>
            <span style={{ fontSize: "14px", fontWeight: 800 }}>{Math.round(data?.current.temp ?? 0)}°</span>
            
            <div style={{ display: "flex", alignItems: "center", gap: "4px", borderLeft: "1px solid var(--border-default)", paddingLeft: "8px", opacity: 0.7 }}>
              <Navigation 
                size={8} 
                style={{ transform: `rotate(${data?.current.winddirection ?? 0}deg)`, color: "var(--blue-bright)" }} 
                fill="var(--blue-bright)" 
              />
              <span style={{ fontSize: "8px", fontWeight: 700, fontFamily: "var(--font-mono)" }}>{Math.round(data?.current.windspeed ?? 0)}<span style={{ fontSize: "7px" }}>km/h</span></span>
            </div>
          </div>

          {/* Icone mini degli altri giorni */}
          {data && [1, 2, 3].map(i => {
              const ui = getWeatherUI(data.daily.codes[i], 12);
              return (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "24px", opacity: 0.6 }}>
                   <div style={{ color: ui.color }}>{ui.icon}</div>
                   <span style={{ fontSize: "8px", fontWeight: 700 }}>{Math.round(data.daily.maxTemps[i])}°</span>
                </div>
              );
          })}
        </div>

        {/* Popover dettagli settimanali */}
        {showForecast && data && (
            <div 
              style={{
                position: "absolute",
                top: "calc(100% + 10px)",
                right: 0,
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-strong)",
                borderRadius: "12px",
                padding: "16px",
                width: "280px",
                boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
                zIndex: 400,
                backdropFilter: "blur(12px)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px", borderBottom: "1px solid var(--border-dim)", paddingBottom: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <Calendar size={13} color="var(--accent)" />
                  <span style={{ fontSize: "10px", fontWeight: 800, color: "var(--text-muted)" }}>PREVISIONE SETTIMANALE</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10px", color: "var(--text-primary)", fontWeight: 700 }}>
                  <Wind size={12} color="var(--blue-bright)" /> {data.current.windspeed} km/h
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {data.daily.dates.map((date, i) => {
                  const ui = getWeatherUI(data.daily.codes[i], 14);
                  return (
                    <div key={date} style={{ display: "grid", gridTemplateColumns: "60px 1fr 30px 30px", alignItems: "center", gap: "10px", padding: "4px 0" }}>
                      <span style={{ fontSize: "10px", fontWeight: 800, color: i === 0 ? "var(--accent)" : "var(--text-soft)" }}>{i === 0 ? "OGGI" : getDayName(date)}</span>
                      <div style={{ display: "flex", color: ui.color }}>{ui.icon}</div>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-primary)", textAlign: "right" }}>{Math.round(data.daily.maxTemps[i])}°</span>
                      <span style={{ fontSize: "11px", fontWeight: 400, color: "var(--text-muted)", textAlign: "right" }}>{Math.round(data.daily.minTemps[i])}°</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: "12px", paddingTop: "8px", borderTop: "1px solid var(--border-dim)", fontSize: "9px", color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
                  Ultimo aggiornamento: {lastUpdated}
                </div>
                <div style={{ fontSize: "8px" }}>Dati Real-Time</div>
              </div>
            </div>
        )}

        {/* Modal Settings con Geocoding Search */}
        {showSettings && (
            <div 
              style={{
                position: "absolute",
                top: "calc(100% + 10px)",
                left: 0,
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-strong)",
                borderRadius: "12px",
                padding: "20px",
                width: "240px",
                boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                zIndex: 401,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                 <span style={{ fontSize: "11px", fontWeight: 800 }}>IMPOSTAZIONI LOCALITÀ</span>
                 <X size={14} onClick={() => setShowSettings(false)} style={{ cursor: "pointer" }} />
              </div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                 <div>
                    <label style={{ fontSize: "8px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>Cerca Città</label>
                    <div style={{ position: "relative", display: "flex", gap: "6px", marginTop: "4px" }}>
                        <input 
                          style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "4px", padding: "6px 30px 6px 8px", width: "100%", color: "white", fontSize: "11px" }}
                          placeholder="es. Milano, Roma..."
                          value={editForm.name}
                          onChange={(e) => setEditForm({...editForm, name: e.target.value.toUpperCase()})}
                          onKeyDown={(e) => e.key === 'Enter' && geocodeCity()}
                        />
                        <button 
                            onClick={geocodeCity}
                            disabled={searching}
                            style={{ position: "absolute", right: "6px", top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", color: "var(--blue-bright)", cursor: "pointer", display: "flex" }}
                        >
                            {searching ? <RefreshCw size={12} className="animate-spin" /> : <Search size={14} />}
                        </button>
                    </div>
                    {searchError && (
                        <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "4px", color: "var(--red)", fontSize: "9px" }}>
                            <AlertCircle size={10} /> {searchError}
                        </div>
                    )}
                 </div>

                 <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", opacity: 0.6 }}>
                    <div>
                        <label style={{ fontSize: "8px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>Lat</label>
                        <input 
                          type="number"
                          readOnly
                          style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "4px", padding: "4px 8px", width: "100%", color: "var(--text-secondary)", fontSize: "10px" }}
                          value={editForm.lat.toFixed(3)}
                        />
                    </div>
                    <div>
                        <label style={{ fontSize: "8px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>Lon</label>
                        <input 
                          type="number"
                          readOnly
                          style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "4px", padding: "4px 8px", width: "100%", color: "var(--text-secondary)", fontSize: "10px" }}
                          value={editForm.lon.toFixed(3)}
                        />
                    </div>
                 </div>

                 <button 
                  onClick={saveLocation}
                  disabled={searching || !editForm.lat}
                  style={{ background: "var(--blue)", border: "none", color: "white", padding: "10px", borderRadius: "6px", fontSize: "11px", fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", marginTop: "4px" }}
                 >
                   <Check size={14} /> APPLICA LOCALITÀ
                 </button>
              </div>
            </div>
        )}

      </div>

      <style jsx>{`
        .animate-spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import "./globals.css";
import { AuthProvider, useAuth } from "./lib/auth";
import WeatherWidget from "./components/WeatherWidget";
import NotificationPanel from "./components/NotificationPanel";
import GlobalQuickTicket from "./components/GlobalQuickTicket";
import { VERSION } from "./lib/version";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-display', display: 'swap' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap', weight: ['400','500','600'] });
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { BackendStatus } from "./components/BackendStatus";
import {
  LayoutDashboard, CalendarClock, ClipboardList, Factory,
  Users, Wrench, CalendarDays, Building, UploadCloud,
  ScrollText, Mail, UserCheck, LogOut, Sun, Moon,
  Activity, Cpu, Zap
} from "lucide-react";

// Fonts now loaded above individually

const NAV = [
  {
    section: "OVERVIEW",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard size={14} strokeWidth={1.8} /> },
    ],
  },
  {
    section: "OPERAZIONI",
    items: [
      { href: "/planning",  label: "Pianificazione", icon: <Zap size={14} strokeWidth={1.8} /> },
      { href: "/ticket",    label: "Ticket",         icon: <Activity size={14} strokeWidth={1.8} /> },
      { href: "/profilo",   label: "Mio Profilo",    icon: <UserCheck size={14} strokeWidth={1.8} /> },
    ],
  },
  {
    section: "RISORSE",
    items: [
      { href: "/asset",    label: "Siti & Asset",       icon: <Cpu size={14} strokeWidth={1.8} /> },
      { href: "/tecnici",  label: "Tecnici",            icon: <Users size={14} strokeWidth={1.8} /> },
      { href: "/piani",    label: "Piano Manutenzione", icon: <Wrench size={14} strokeWidth={1.8} /> },
      { href: "/scadenze", label: "Scadenze PM",        icon: <CalendarDays size={14} strokeWidth={1.8} /> },
    ],
  },
  {
    section: "ADMIN",
    items: [
      { href: "/admin/tenants",     label: "Clienti",            icon: <Building size={14} strokeWidth={1.8} />,    superadminOnly: true },
      { href: "/admin/bulk-import", label: "Import Massivo",     icon: <UploadCloud size={14} strokeWidth={1.8} />, superadminOnly: true },
      { href: "/admin/logs",        label: "Log Sistema",        icon: <ScrollText size={14} strokeWidth={1.8} />,  adminOnly: true },
      { href: "/admin/email",       label: "Email-to-Ticket",    icon: <Mail size={14} strokeWidth={1.8} />,        adminOnly: true },
    ],
  },
];

const PAGE_LABELS: Record<string, string> = {
  "/dashboard":          "Dashboard",
  "/asset":              "Siti & Asset",
  "/assets":             "Asset",
  "/impianti":           "Impianti",
  "/tecnici":            "Tecnici",
  "/planning":           "Pianificazione",
  "/ticket":             "Ticket",
  "/piani":              "Piano di Manutenzione",
  "/piani-manutenzione": "Piano di Manutenzione",
  "/scadenze":           "Calendario Scadenze PM",
  "/admin/tenants":      "Gestione Clienti",
  "/admin/bulk-import":  "Import Massivo",
  "/admin/logs":         "Log di Sistema",
  "/admin/email":        "Integrazione Email-to-Ticket",
  "/profilo":            "Mio Profilo",
};

function GlobalOfflineIndicator() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div style={{
      position: "fixed",
      bottom: 0, left: 0, right: 0,
      padding: "8px 16px",
      background: "#7c2d12",
      color: "#fef3c7",
      fontSize: 12,
      fontWeight: 700,
      textAlign: "center",
      zIndex: 9999,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    }}>
      <span>📡</span>
      Modalità offline — alcune funzioni non disponibili. Dati visibili dal cache locale.
    </div>
  );
}

function AppLayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, logout, user } = useAuth();
  const [time, setTime] = useState("");
  const [theme, setTheme] = useState("dark");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js")
        .then((reg) => { console.log("[MaintAI] Service Worker registrato:", reg.scope); })
        .catch((err) => { console.warn("[MaintAI] Service Worker non registrato:", err); });
    }
  }, []);

  const isTecnico = user?.ruolo === "tecnico";
  const isSuperadmin = user?.ruolo === "superadmin";

  const filteredNav = NAV.map(section => ({
    ...section,
    items: section.items.filter((item: any) => {
      if (item.superadminOnly && !isSuperadmin) return false;
      if (item.adminOnly && user?.ruolo !== "responsabile" && !isSuperadmin) return false;
      if (!isTecnico) return true;
      const visibleForTecnico = ["/ticket", "/asset", "/profilo"];
      return visibleForTecnico.includes(item.href);
    })
  })).filter(section => section.items.length > 0);

  useEffect(() => {
    if (isTecnico && (pathname === "/dashboard" || pathname === "/")) {
      router.push("/mobile");
    }
  }, [isTecnico, pathname, router]);

  useEffect(() => {
    const local = localStorage.getItem("maintai_theme");
    if (local) setTheme(local);
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("maintai_theme", nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
  };

  useEffect(() => {
    function tick() {
      setTime(new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!isAuthenticated && pathname !== "/login") {
      router.push("/login");
    }
  }, [isAuthenticated, pathname, router]);

  if (!isAuthenticated || pathname === "/login") {
    return <main style={{ height: "100vh", width: "100vw" }}>{children}</main>;
  }

  const pageLabel = Object.entries(PAGE_LABELS).find(([k]) => pathname.startsWith(k))?.[1] ?? "MaintAI";

  const sectionLabel = filteredNav.find((group) =>
    group.items.some((item) => pathname === item.href || pathname.startsWith(item.href + "/"))
  )?.section ?? "OPERAZIONI";

  return (
    <div className={`app-shell${sidebarOpen ? " sidebar-open" : ""}`} data-theme="dark">

      {/* ══════════════════════════════════════════════════════════
          SIDEBAR — NUOVA IDENTITÀ VISIVA
          Ultra-dark glass panel, glow icons, neon accents
          ══════════════════════════════════════════════════════════ */}
      <aside className={`app-sidebar${sidebarOpen ? " open" : ""}`} style={{
        width: 220,
        background: "linear-gradient(180deg, #07101f 0%, #050c18 100%)",
        borderRight: "1px solid rgba(91,143,255,0.12)",
        display: "flex",
        flexDirection: "column",
        position: "fixed",
        top: 0, left: 0,
        height: "100vh",
        zIndex: 50,
        overflowY: "auto",
        overflowX: "hidden",
      }}>
        {/* Ambient top glow */}
        <div style={{ position: "absolute", top: -60, left: "50%", transform: "translateX(-50%)", width: 200, height: 120, background: "radial-gradient(ellipse, rgba(91,143,255,0.18) 0%, transparent 70%)", pointerEvents: "none" }} />
        {/* Scan lines texture */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(91,143,255,0.012) 3px, rgba(91,143,255,0.012) 4px)", pointerEvents: "none", zIndex: 0 }} />

        {/* Mobile overlay */}
        <div className="sidebar-mobile-overlay" onClick={() => setSidebarOpen(false)} />

        {/* ── LOGO ──────────────────────────────────────── */}
        <Link href="/dashboard" style={{ textDecoration: "none", position: "relative", zIndex: 1 }} onClick={() => setSidebarOpen(false)}>
          <div style={{
            padding: "20px 18px 18px",
            display: "flex", alignItems: "center", gap: 11,
            borderBottom: "1px solid rgba(91,143,255,0.10)",
          }}>
            {/* Glowing logo badge */}
            <div style={{
              width: 36, height: 36,
              background: "linear-gradient(135deg, #3a6ff5 0%, #7b5cff 100%)",
              borderRadius: 10,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 900, color: "white", letterSpacing: "0.05em",
              fontFamily: "var(--font-display)",
              boxShadow: "0 0 20px rgba(91,143,255,0.55), 0 0 50px rgba(91,143,255,0.20), inset 0 1px 0 rgba(255,255,255,0.2)",
              flexShrink: 0,
            }}>AI</div>
            <div>
              <div style={{
                fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 900,
                letterSpacing: "0.12em",
                background: "linear-gradient(90deg, #90b8ff 0%, #c4b0ff 100%)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                lineHeight: 1,
              }}>MAINTAI</div>
              <div style={{ fontSize: 8.5, color: "rgba(91,143,255,0.45)", letterSpacing: "0.20em", textTransform: "uppercase", marginTop: 3, fontWeight: 600 }}>
                Manutenzione Ind.
              </div>
            </div>
          </div>
        </Link>

        {/* ── NAV GROUPS ────────────────────────────────── */}
        <div style={{ flex: 1, padding: "12px 10px", position: "relative", zIndex: 1 }}>
          {filteredNav.map((group) => (
            <div key={group.section} style={{ marginBottom: 6 }}>
              <div style={{
                fontSize: 8, fontWeight: 800, letterSpacing: "0.28em",
                textTransform: "uppercase",
                color: "rgba(91,143,255,0.35)",
                padding: "10px 8px 4px",
              }}>{group.section}</div>
              <nav style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {group.items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setSidebarOpen(false)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "9px 10px 9px 12px",
                        borderRadius: 9,
                        textDecoration: "none",
                        fontSize: 13,
                        fontWeight: active ? 700 : 500,
                        letterSpacing: active ? "-0.01em" : "0",
                        color: active ? "#90b8ff" : "rgba(148,163,184,0.75)",
                        background: active
                          ? "linear-gradient(90deg, rgba(91,143,255,0.18) 0%, rgba(91,143,255,0.06) 100%)"
                          : "transparent",
                        border: active
                          ? "1px solid rgba(91,143,255,0.20)"
                          : "1px solid transparent",
                        boxShadow: active ? "inset 4px 0 0 #5b8fff, 0 2px 12px rgba(91,143,255,0.08)" : "none",
                        transition: "all 160ms cubic-bezier(0.22,1,0.36,1)",
                        position: "relative",
                        overflow: "hidden",
                      }}
                      onMouseEnter={e => {
                        if (!active) {
                          (e.currentTarget as HTMLAnchorElement).style.background = "rgba(91,143,255,0.07)";
                          (e.currentTarget as HTMLAnchorElement).style.color = "rgba(200,220,255,0.95)";
                          (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(91,143,255,0.12)";
                        }
                      }}
                      onMouseLeave={e => {
                        if (!active) {
                          (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
                          (e.currentTarget as HTMLAnchorElement).style.color = "rgba(148,163,184,0.75)";
                          (e.currentTarget as HTMLAnchorElement).style.borderColor = "transparent";
                        }
                      }}
                    >
                      {/* Icon container */}
                      <span style={{
                        width: 28, height: 28,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        borderRadius: 7,
                        background: active ? "rgba(91,143,255,0.20)" : "rgba(255,255,255,0.04)",
                        color: active ? "#7aa8ff" : "rgba(148,163,184,0.6)",
                        flexShrink: 0,
                        transition: "all 160ms",
                        boxShadow: active ? "0 0 10px rgba(91,143,255,0.25)" : "none",
                      }}>
                        {item.icon}
                      </span>
                      {item.label}
                      {active && (
                        <span style={{
                          marginLeft: "auto",
                          width: 6, height: 6,
                          borderRadius: "50%",
                          background: "#5b8fff",
                          boxShadow: "0 0 8px #5b8fff",
                          flexShrink: 0,
                        }} />
                      )}
                    </Link>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>

        {/* ── SIDEBAR FOOTER ────────────────────────────── */}
        <div style={{
          padding: "10px 12px 14px",
          borderTop: "1px solid rgba(91,143,255,0.08)",
          position: "relative", zIndex: 1,
        }}>
          {isSuperadmin && (
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 8.5, color: "rgba(91,143,255,0.4)", display: "block", marginBottom: 4, letterSpacing: "0.16em", textTransform: "uppercase", fontWeight: 700 }}>
                Contesto Tenant
              </label>
              <select
                style={{
                  background: "rgba(91,143,255,0.07)",
                  color: "#90b8ff",
                  border: "1px solid rgba(91,143,255,0.18)",
                  borderRadius: 7,
                  fontSize: 11,
                  padding: "5px 8px",
                  width: "100%",
                  outline: "none",
                  fontFamily: "var(--font-body)",
                }}
                defaultValue={typeof window !== "undefined" ? (localStorage.getItem("maintai_tenant_context") || "") : ""}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val) localStorage.setItem("maintai_tenant_context", val);
                  else localStorage.removeItem("maintai_tenant_context");
                  window.location.reload();
                }}
              >
                <option value="">Global (Tutti)</option>
                <option value="1">Tenant Demo (#1)</option>
              </select>
            </div>
          )}

          {user?.tenant_nome && (
            <div style={{
              fontSize: 10, color: "rgba(91,143,255,0.45)",
              marginBottom: 8, letterSpacing: "0.08em",
              textTransform: "uppercase", fontWeight: 600,
              display: "flex", alignItems: "center", gap: 5,
            }}>
              <span style={{ color: "#5b8fff", opacity: 0.7 }}>◈</span>
              <span>{user.tenant_nome}</span>
            </div>
          )}

          {/* System status pill */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 10px",
            background: "rgba(16,217,176,0.06)",
            border: "1px solid rgba(16,217,176,0.15)",
            borderRadius: 8,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: "#10d9b0",
              boxShadow: "0 0 8px rgba(16,217,176,0.8), 0 0 16px rgba(16,217,176,0.4)",
              flexShrink: 0,
              animation: "statusPulse 2.5s infinite",
            }} />
            <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.14em", color: "#10d9b0", textTransform: "uppercase" }}>
              {isSuperadmin ? "SUPERADMIN" : isTecnico ? "CAMPO" : "SISTEMA OK"}
            </span>
            <span style={{ marginLeft: "auto", fontSize: 9, color: "rgba(91,143,255,0.4)", fontFamily: "var(--font-mono)" }}>
              v{VERSION}
            </span>
          </div>
        </div>
      </aside>

      {/* ══════════════════════════════════════════════════════════
          MAIN
          ══════════════════════════════════════════════════════════ */}
      <div style={{
        marginLeft: 220,
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        background: "#060a12",
      }}>

        {/* ── TOPBAR ──────────────────────────────────────── */}
        <header style={{
          height: 54,
          background: "linear-gradient(90deg, rgba(7,11,20,0.97) 0%, rgba(6,10,18,0.99) 100%)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderBottom: "1px solid rgba(91,143,255,0.10)",
          display: "flex", alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px 0 24px",
          position: "sticky", top: 0, zIndex: 40,
          boxShadow: "0 1px 0 rgba(91,143,255,0.06), 0 8px 32px rgba(0,0,0,0.4)",
        }}>
          {/* Breadcrumb */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              className="mobile-menu-btn"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Apri menu"
            >☰</button>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontSize: 9.5, letterSpacing: "0.20em", textTransform: "uppercase", color: "rgba(91,143,255,0.45)", fontWeight: 700 }}>
                {sectionLabel}
              </span>
              <span style={{ color: "rgba(91,143,255,0.25)", fontSize: 14 }}>›</span>
              <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em", color: "#edf0f7", fontFamily: "var(--font-display)" }}>
                {pageLabel}
              </span>
            </div>
          </div>

          {/* Right controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <GlobalQuickTicket />

            <div style={{ width: 1, height: 22, background: "rgba(91,143,255,0.10)", margin: "0 4px" }} />

            <NotificationPanel />
            <WeatherWidget />

            {/* Clock */}
            <div style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              color: "rgba(91,143,255,0.55)",
              letterSpacing: "0.08em",
              background: "rgba(91,143,255,0.06)",
              border: "1px solid rgba(91,143,255,0.10)",
              padding: "4px 10px",
              borderRadius: 7,
            }}>{time}</div>

            {/* Theme */}
            <button
              onClick={toggleTheme}
              style={{
                width: 34, height: 34,
                display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: 8,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
                color: "rgba(148,163,184,0.7)",
                cursor: "pointer",
                transition: "all 140ms",
              }}
              title={theme === "dark" ? "Tema chiaro" : "Tema scuro"}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(91,143,255,0.10)"; (e.currentTarget as HTMLButtonElement).style.color = "#90b8ff"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.03)"; (e.currentTarget as HTMLButtonElement).style.color = "rgba(148,163,184,0.7)"; }}
            >
              {theme === "dark" ? <Sun size={14} strokeWidth={1.8} /> : <Moon size={14} strokeWidth={1.8} />}
            </button>

            {/* User badge + logout */}
            <div style={{
              display: "flex", alignItems: "center", gap: 9,
              borderLeft: "1px solid rgba(91,143,255,0.10)",
              paddingLeft: 12, marginLeft: 2,
            }}>
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2,
              }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#edf0f7", lineHeight: 1, letterSpacing: "-0.01em" }}>
                  {user?.username}
                </span>
                <span style={{
                  fontSize: 8.5, fontWeight: 800, lineHeight: 1,
                  letterSpacing: "0.14em", textTransform: "uppercase",
                  color: "#5b8fff",
                  background: "rgba(91,143,255,0.12)",
                  padding: "1.5px 6px", borderRadius: 4,
                }}>
                  {user?.ruolo}
                </span>
              </div>
              <button
                onClick={logout}
                title="Esci"
                style={{
                  width: 32, height: 32,
                  background: "rgba(240,82,82,0.04)",
                  border: "1px solid rgba(240,82,82,0.15)",
                  color: "rgba(240,82,82,0.7)",
                  borderRadius: 8,
                  cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 140ms",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = "rgba(240,82,82,0.12)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(240,82,82,0.35)";
                  (e.currentTarget as HTMLButtonElement).style.color = "#f87171";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = "rgba(240,82,82,0.04)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(240,82,82,0.15)";
                  (e.currentTarget as HTMLButtonElement).style.color = "rgba(240,82,82,0.7)";
                }}
              >
                <LogOut size={13} strokeWidth={2} />
              </button>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main style={{ padding: "24px", flex: 1 }}>
          {children}
        </main>
      </div>
    </div>
  );
}




export default function RootLayout({ children }: { children: React.ReactNode }) {
  const themeScript = `
    (function() {
      try {
        var t = localStorage.getItem('maintai_theme');
        if (t) document.documentElement.setAttribute('data-theme', t);
      } catch(e) {}
    })();
  `;

  return (
    <html lang="it" suppressHydrationWarning className={cn("font-sans", inter.variable, spaceGrotesk.variable, jetbrainsMono.variable)}>
      <head>
        <title>MaintAI — Centro di Controllo</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#3b82f6" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AuthProvider>
          <AppLayoutContent>{children}</AppLayoutContent>
        </AuthProvider>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: "var(--surface-2)",
              border: "1px solid var(--border-strong)",
              color: "var(--text-primary)",
              fontFamily: "var(--font-body)",
            },
          }}
        />
        <GlobalOfflineIndicator />
        <BackendStatus />
      </body>
    </html>
  );
}

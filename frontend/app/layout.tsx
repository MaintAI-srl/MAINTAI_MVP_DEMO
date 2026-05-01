"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import "./globals.css";
import { AuthProvider, useAuth } from "./lib/auth";
import WeatherWidget from "./components/WeatherWidget";
import NotificationPanel from "./components/NotificationPanel";
import GlobalQuickTicket from "./components/GlobalQuickTicket";
import { DISPLAY_VERSION } from "./lib/version";
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
  ScrollText, Mail, UserCheck, UserCog, LogOut, Sun, Moon,
  Activity, Cpu, Zap, BrainCircuit, Settings
} from "lucide-react";

// Fonts now loaded above individually

const NAV = [
  {
    section: "DASHBOARD",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard size={14} strokeWidth={1.8} /> },
    ],
  },
  {
    section: "OPERAZIONI",
    items: [
      { href: "/ticket",     label: "Ticket",               icon: <Activity size={14} strokeWidth={1.8} /> },
      { href: "/planning",   label: "Pianificazione",       icon: <Zap size={14} strokeWidth={1.8} /> },
      { href: "/diagnostic", label: "Analisi Ingegneria AI", icon: <BrainCircuit size={14} strokeWidth={1.8} /> },
    ],
  },
  {
    section: "RISORSE",
    items: [
      { href: "/asset",    label: "Siti & Asset",         icon: <Cpu size={14} strokeWidth={1.8} /> },
      { href: "/tecnici",  label: "Tecnici",              icon: <Users size={14} strokeWidth={1.8} /> },
      { href: "/piani",    label: "Piani di Manutenzione", icon: <Wrench size={14} strokeWidth={1.8} /> },
      { href: "/scadenze", label: "Scadenziario",         icon: <CalendarDays size={14} strokeWidth={1.8} /> },
    ],
  },
  {
    section: "IMPOSTAZIONI",
    items: [
      { href: "/admin/tenants",     label: "Clienti",          icon: <Building size={14} strokeWidth={1.8} />,    superadminOnly: true },
      { href: "/admin/bulk-import", label: "Import Massivo",   icon: <UploadCloud size={14} strokeWidth={1.8} />, adminOnly: true },
      { href: "/admin/logs",        label: "Log di Sistema",   icon: <ScrollText size={14} strokeWidth={1.8} />,  adminOnly: true },
      { href: "/admin/email",       label: "Email to Ticket",  icon: <Mail size={14} strokeWidth={1.8} />,        adminOnly: true },
      { href: "/profilo",           label: "Mio Profilo",      icon: <UserCheck size={14} strokeWidth={1.8} /> },
      { href: "/admin/utenti",      label: "Gestione Utenti",  icon: <UserCog size={14} strokeWidth={1.8} />,     adminOnly: true },
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
  "/diagnostic":         "Analisi Ingegneria AI",
  "/piani":              "Piani di Manutenzione",
  "/piani-manutenzione": "Piani di Manutenzione",
  "/scadenze":           "Scadenziario",
  "/admin/tenants":      "Clienti",
  "/admin/bulk-import":  "Import Massivo",
  "/admin/logs":         "Log di Sistema",
  "/admin/email":        "Email to Ticket",
  "/admin/utenti":       "Gestione Utenti",
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
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });

      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
        .then((reg) => {
          console.log("[MaintAI] Service Worker registrato:", reg.scope);
          reg.update().catch((err) => console.warn("[MaintAI] Service Worker update fallito:", err));
        })
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
    <div className={`app-shell${sidebarOpen ? " sidebar-open" : ""}`}>

      {/* ══════════════════════════════════════════════════════════
          SIDEBAR — NUOVA IDENTITÀ VISIVA
          Ultra-dark glass panel, glow icons, neon accents
          ══════════════════════════════════════════════════════════ */}
      <aside className={`app-sidebar${sidebarOpen ? " open" : ""}`}>
        {/* Ambient top glow */}
        <div style={{ position: "absolute", top: -60, left: "50%", transform: "translateX(-50%)", width: 200, height: 120, background: "radial-gradient(ellipse, rgba(91,143,255,0.18) 0%, transparent 70%)", pointerEvents: "none" }} />
        {/* Scan lines texture */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(91,143,255,0.012) 3px, rgba(91,143,255,0.012) 4px)", pointerEvents: "none", zIndex: 0 }} />

        {/* Mobile overlay */}
        <div className="sidebar-mobile-overlay" onClick={() => setSidebarOpen(false)} />

        {/* ── LOGO ──────────────────────────────────────── */}
        <Link href="/dashboard" className="sidebar-logo" style={{ textDecoration: "none", zIndex: 1 }} onClick={() => setSidebarOpen(false)}>
          {/* Logo con glow */}
          <div className="sidebar-logo-icon" style={{ background: "var(--cobalt-dim)", border: "1px solid var(--cobalt-border)", boxShadow: "var(--glow-cobalt)" }}>
            <img
              src="/logo.png"
              alt="MaintAI"
              style={{ width: 28, height: 28, objectFit: "contain" }}
            />
          </div>
          <div className="sidebar-logo-text">
            <div className="sidebar-logo-name">MAINTAI</div>
            <div className="sidebar-logo-sub">
              Manutenzione Ind.
            </div>
          </div>
        </Link>

        {/* ── NAV GROUPS ────────────────────────────────── */}
        <div style={{ flex: 1, padding: "12px 10px", position: "relative", zIndex: 1 }}>
          {filteredNav.map((group) => (
            <div key={group.section} style={{ marginBottom: 6 }}>
              <div className="sidebar-section-label">{group.section}</div>
              <nav style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {group.items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setSidebarOpen(false)}
                      className={active ? "nav-item active" : "nav-item"}
                    >
                      <span className="nav-icon">
                        {item.icon}
                      </span>
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>

        {/* ── SIDEBAR FOOTER ────────────────────────────── */}
        <div className="sidebar-footer">
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
          <div className="system-status">
            <span className="status-pulse" />
            <span className="status-text">
              {isSuperadmin ? "SUPERADMIN" : isTecnico ? "CAMPO" : "SISTEMA OK"}
            </span>
            <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              v{DISPLAY_VERSION}
            </span>
          </div>
        </div>
      </aside>

      {/* ══════════════════════════════════════════════════════════
          MAIN
          ══════════════════════════════════════════════════════════ */}
      <div className="app-main">

        {/* ── TOPBAR ──────────────────────────────────────── */}
        <header className="app-topbar">
          {/* Breadcrumb */}
          <div className="topbar-breadcrumb">
            <button
              className="mobile-menu-btn"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Apri menu"
            >☰</button>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span className="topbar-section">
                {sectionLabel}
              </span>
              <span className="topbar-sep">›</span>
              <span className="topbar-page">
                {pageLabel}
              </span>
            </div>
          </div>

          {/* Right controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <GlobalQuickTicket />

            <div style={{ width: 1, height: 22, background: "var(--border-subtle)", margin: "0 4px" }} />

            <NotificationPanel />
            <WeatherWidget />

            {/* Clock */}
            <div className="topbar-time">{time}</div>

            {/* Theme */}
            <button
              onClick={toggleTheme}
              className="topbar-icon-btn"
              title={theme === "dark" ? "Tema chiaro" : "Tema scuro"}
            >
              {theme === "dark" ? <Sun size={14} strokeWidth={1.8} /> : <Moon size={14} strokeWidth={1.8} />}
            </button>

            {/* User badge + logout */}
            <div style={{
              display: "flex", alignItems: "center", gap: 9,
              borderLeft: "1px solid var(--border-subtle)",
              paddingLeft: 12, marginLeft: 2,
            }}>
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2,
              }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1, letterSpacing: "-0.01em" }}>
                  {user?.username}
                </span>
                <span style={{
                  fontSize: 8.5, fontWeight: 800, lineHeight: 1,
                  letterSpacing: "0.14em", textTransform: "uppercase",
                  color: "var(--cobalt)",
                  background: "var(--cobalt-dim)",
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
                  background: "var(--red-dim)",
                  border: "1px solid var(--red-border)",
                  color: "var(--red)",
                  borderRadius: 8,
                  cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 140ms",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = "rgba(240,82,82,0.15)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--red)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--red-dim)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--red-border)";
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

"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import "./globals.css";
import { AuthProvider, useAuth } from "./lib/auth";
import WeatherWidget from "./components/WeatherWidget";
import NotificationPanel from "./components/NotificationPanel";
import { VERSION } from "./lib/version";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const NAV = [
  {
    section: "OVERVIEW",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "⬡" },
    ],
  },
  {
    section: "VISUALIZZAZIONI",
    items: [
      { href: "/planning",  label: "Piano AI",       icon: "⚡" },
      { href: "/ticket",    label: "Ticket",         icon: "◷" },
      { href: "/profilo",   label: "Mio Profilo",    icon: "👤" },
    ],
  },
  {
    section: "IMPOSTAZIONI",
    items: [
      { href: "/asset",     label: "Siti & Asset", icon: "◬" },
      { href: "/tecnici",   label: "Tecnici",      icon: "◎" },
      { href: "/manuali",   label: "Manuali",               icon: "◧" },
      { href: "/piani",     label: "Piano Manutenzione",    icon: "◩" },
      { href: "/scadenze",  label: "Scadenze PM",           icon: "📅" },
    ],
  },
  {
    section: "ADMIN",
    items: [
      { href: "/admin/tenants",     label: "Clienti", icon: "◈", superadminOnly: true },
      { href: "/admin/bulk-import", label: "Import Massivo", icon: "⬆", superadminOnly: true },
      { href: "/admin/logs",        label: "Log Sistema", icon: "📋", adminOnly: true },
      { href: "/admin/email",       label: "Integrazione Email", icon: "✉️", adminOnly: true },
    ],
  },
];

const PAGE_LABELS: Record<string, string> = {
  "/dashboard":  "Dashboard",
  "/asset":      "Siti & Asset",
  "/assets":     "Asset",
  "/impianti":   "Impianti",
  "/tecnici":    "Tecnici",
  "/planning":   "Piano AI — MARCO",
  "/ticket":     "Ticket",
  "/manuali":    "Manuali",
  "/piani":              "Piano di Manutenzione — Task",
  "/piani-manutenzione": "Piano di Manutenzione — Task",
  "/scadenze":       "Calendario Scadenze PM",
  "/admin/tenants":     "Gestione Clienti",
  "/admin/bulk-import": "Import Massivo",
  "/admin/logs":        "Log di Sistema",
  "/admin/email":       "Integrazione Email-to-Ticket",
  "/profilo":       "Mio Profilo",
};

// ── Indicatore connessione — visibile a tutti gli utenti ─────────────────────
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

  // ── Service Worker registration (#23 PWA, #26 Offline) ───────────────────
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js")
        .then((reg) => {
          console.log("[MaintAI] Service Worker registrato:", reg.scope);
        })
        .catch((err) => {
          // Non-critical: log ma non interrompere l'app
          console.warn("[MaintAI] Service Worker non registrato:", err);
        });
    }
  }, []);

  const isTecnico = user?.ruolo === "tecnico";
  const isSuperadmin = user?.ruolo === "superadmin";

  // Filtra la navigazione in base al ruolo
  const filteredNav = NAV.map(section => ({
    ...section,
    items: section.items.filter((item: any) => {
      if (item.superadminOnly && !isSuperadmin) return false;
      if (item.adminOnly && user?.ruolo !== "responsabile" && !isSuperadmin) return false;
      if (!isTecnico) return true;
      const visibleForTecnico = ["/ticket", "/asset", "/manuali", "/profilo"];
      return visibleForTecnico.includes(item.href);
    })
  })).filter(section => section.items.length > 0);

  useEffect(() => {
    if (isTecnico && (pathname === "/dashboard" || pathname === "/")) {
      router.push("/mobile"); // Reindirizza il tecnico alla dashboard semplificata
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
     return <main style={{ height: '100vh', width: '100vw' }}>{children}</main>;
  }

  const pageLabel = Object.entries(PAGE_LABELS).find(([k]) => pathname.startsWith(k))?.[1] ?? "MaintAI";

  const sectionLabel = filteredNav.find((group) =>
    group.items.some((item) => pathname === item.href || pathname.startsWith(item.href + "/"))
  )?.section ?? "OPERAZIONI";

  return (
    <div className={`app-shell ${sidebarOpen ? 'sidebar-open' : ''}`}>

          {/* ── SIDEBAR ── */}
          <aside className={`app-sidebar ${sidebarOpen ? 'open' : ''}`}>
            {/* Overlay mobile per chiudere */}
            <div className="sidebar-mobile-overlay" onClick={() => setSidebarOpen(false)} />

            {/* Logo */}
            <Link href="/dashboard" className="sidebar-logo" style={{ textDecoration: "none", cursor: "pointer" }} onClick={() => setSidebarOpen(false)}>
              <img
                src="/logo.png"
                alt="Logo MaintAI"
                style={{ width: "32px", height: "32px", objectFit: "contain", marginRight: "12px" }}
              />
              <div className="sidebar-logo-text">
                <span className="sidebar-logo-name">MAINTAI</span>
                <span className="sidebar-logo-sub">Manutenzione</span>
                <span style={{ fontSize: "11px", color: "var(--blue)", opacity: 0.9, letterSpacing: "0.5px", fontWeight: 600 }}>v{VERSION}</span>
              </div>
            </Link>

            {/* Navigation */}
            {filteredNav.map((group) => (
              <div className="sidebar-section" key={group.section}>
                <div className="sidebar-section-label">{group.section}</div>
                <nav className="sidebar-nav">
                  {group.items.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(item.href + "/");
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`nav-item${active ? " active" : ""}`}
                        onClick={() => setSidebarOpen(false)}
                      >
                        <span style={{ fontSize: "15px", lineHeight: 1 }}>{item.icon}</span>
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
              </div>
            ))}

            <div className="sidebar-footer">
              {isSuperadmin && (
                <div style={{ marginBottom: "12px" }}>
                  <label style={{ fontSize: "9px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>CONTESTO TENANT</label>
                  <select 
                    style={{ background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--border-strong)", borderRadius: "4px", fontSize: "11px", padding: "4px", width: "100%", outline: "none" }}
                    value={localStorage.getItem("maintai_tenant_context") || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val) localStorage.setItem("maintai_tenant_context", val);
                      else localStorage.removeItem("maintai_tenant_context");
                      window.location.reload(); // Ricarica per applicare il nuovo contesto
                    }}
                  >
                    <option value="">Global (Tutti)</option>
                    {/* Qui servirebbe una lista di tenant, ma per ora il superadmin può inserirne uno o gestire da /admin/tenants */}
                    <option value="1">Tenant Demo (#1)</option>
                  </select>
                </div>
              )}
              {user?.tenant_nome && (
                <div style={{ fontSize: "10px", color: "var(--text-secondary)", opacity: 0.7, marginBottom: "6px", letterSpacing: "0.5px", textTransform: "uppercase" }}>
                  ◈ {user.tenant_nome}
                </div>
              )}
              <div className="system-status">
                <span className="status-pulse" />
                <span className="status-text">{isSuperadmin ? "SUPERADMIN" : isTecnico ? "MODALITÀ CAMPO" : "SISTEMA OK"}</span>
              </div>
            </div>

          </aside>

          {/* ── MAIN ── */}
          <div className="app-main">

            {/* Topbar */}
            <header className="app-topbar">
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <button 
                  className="mobile-menu-btn"
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                >
                  ☰
                </button>
                <div className="topbar-breadcrumb">
                  <span className="topbar-section">{sectionLabel}</span>
                  <span className="topbar-sep">›</span>
                  <span className="topbar-page">{pageLabel}</span>
                </div>
              </div>
              <div className="topbar-right">
                <NotificationPanel />
                <WeatherWidget />
                <span className="topbar-time">{time}</span>
                <button 
                  onClick={toggleTheme} 
                  style={{ background: "transparent", border: "1px solid var(--border-strong)", borderRadius: "6px", width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "14px" }}
                  title="Cambia tema"
                >
                  {theme === "dark" ? "🌞" : "🌙"}
                </button>
                <span className="badge badge-green" style={{ marginRight: "12px" }}>● ONLINE</span>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", borderLeft: "1px solid var(--border-strong)", paddingLeft: "12px" }}>
                  <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-secondary)" }}>{user?.username} ({user?.ruolo})</span>
                  <button 
                    onClick={logout} 
                    style={{ background: "transparent", border: "1px solid var(--border-strong)", color: "#fca5a5", padding: "4px 10px", borderRadius: "6px", cursor: "pointer", fontSize: "12px" }}
                  >
                    Esci
                  </button>
                </div>
              </div>
            </header>

            {/* Page content */}
            <main className="app-content">
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
        var localTheme = localStorage.getItem('maintai_theme');
        if (localTheme) {
          document.documentElement.setAttribute('data-theme', localTheme);
        }
      } catch (e) {}
    })();
  `;

  return (
    <html lang="it" suppressHydrationWarning className={cn("font-sans", geist.variable)}>
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
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
              color: "var(--text-primary)",
              fontFamily: "var(--font-body)",
            },
          }}
        />
        <GlobalOfflineIndicator />
      </body>
    </html>
  );
}

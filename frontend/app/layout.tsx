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
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { BackendStatus } from "./components/BackendStatus";
import {
  LayoutDashboard, CalendarClock, ClipboardList, Factory,
  Users, Wrench, CalendarDays, Building, UploadCloud,
  ScrollText, Mail, UserCheck
} from "lucide-react";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const NAV = [
  {
    section: "OVERVIEW",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard size={15} /> },
    ],
  },
  {
    section: "VISUALIZZAZIONI",
    items: [
      { href: "/planning",  label: "Pianificazione", icon: <CalendarClock size={15} /> },
      { href: "/ticket",    label: "Ticket",         icon: <ClipboardList size={15} /> },
      { href: "/profilo",   label: "Mio Profilo",    icon: <UserCheck size={15} /> },
    ],
  },
  {
    section: "IMPOSTAZIONI",
    items: [
      { href: "/asset",    label: "Siti & Asset",       icon: <Factory size={15} /> },
      { href: "/tecnici",  label: "Tecnici",            icon: <Users size={15} /> },
      { href: "/piani",    label: "Piano Manutenzione", icon: <Wrench size={15} /> },
      { href: "/scadenze", label: "Scadenze PM",        icon: <CalendarDays size={15} /> },
    ],
  },
  {
    section: "ADMIN",
    items: [
      { href: "/admin/tenants",     label: "Clienti",            icon: <Building size={15} />,    superadminOnly: true },
      { href: "/admin/bulk-import", label: "Import Massivo",     icon: <UploadCloud size={15} />, superadminOnly: true },
      { href: "/admin/logs",        label: "Log Sistema",        icon: <ScrollText size={15} />,  adminOnly: true },
      { href: "/admin/email",       label: "Integrazione Email", icon: <Mail size={15} />,        adminOnly: true },
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
    <div className={`app-shell${sidebarOpen ? " sidebar-open" : ""}`}>

      {/* ── SIDEBAR ────────────────────────────────────────────── */}
      <aside className={`app-sidebar${sidebarOpen ? " open" : ""}`}>

        {/* Mobile overlay */}
        <div className="sidebar-mobile-overlay" onClick={() => setSidebarOpen(false)} />

        {/* Logo */}
        <Link
          href="/dashboard"
          className="sidebar-logo"
          style={{ textDecoration: "none" }}
          onClick={() => setSidebarOpen(false)}
        >
          <img
            src="/logo.png"
            alt="MaintAI"
            style={{ width: 28, height: 28, objectFit: "contain", flexShrink: 0 }}
          />
          <div className="sidebar-logo-text">
            <span className="sidebar-logo-name">MAINTAI</span>
            <span className="sidebar-logo-sub">Manutenzione Industriale</span>
          </div>
        </Link>

        {/* Nav groups */}
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
                    <span className="nav-icon" style={{ display: "flex", alignItems: "center" }}>
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        ))}

        {/* Footer */}
        <div className="sidebar-footer">
          {isSuperadmin && (
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 9, color: "var(--text-muted)", display: "block", marginBottom: 4, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700 }}>
                Contesto Tenant
              </label>
              <select
                style={{
                  background: "var(--surface-2)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-default)",
                  borderRadius: 4,
                  fontSize: 11,
                  padding: "4px 8px",
                  width: "100%",
                  outline: "none",
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
              fontSize: 10,
              color: "var(--text-muted)",
              marginBottom: 8,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 5,
              paddingLeft: 2,
            }}>
              <span style={{ opacity: 0.6 }}>◈</span>
              <span>{user.tenant_nome}</span>
            </div>
          )}

          <div className="system-status">
            <span className="status-pulse" />
            <span className="status-text">
              {isSuperadmin ? "SUPERADMIN" : isTecnico ? "CAMPO" : "SISTEMA OK"}
            </span>
            <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              v{VERSION}
            </span>
          </div>
        </div>
      </aside>

      {/* ── MAIN ───────────────────────────────────────────────── */}
      <div className="app-main">

        {/* Topbar */}
        <header className="app-topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              className="mobile-menu-btn"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Apri menu"
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
            <GlobalQuickTicket />
            <NotificationPanel />
            <WeatherWidget />

            <span className="topbar-time">{time}</span>

            <button
              onClick={toggleTheme}
              className="topbar-icon-btn"
              title="Cambia tema"
            >
              {theme === "dark" ? "🌞" : "🌙"}
            </button>

            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              borderLeft: "1px solid var(--border-subtle)",
              paddingLeft: 10,
              marginLeft: 2,
            }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1 }}>
                  {user?.username}
                </span>
                <span style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, lineHeight: 1 }}>
                  {user?.ruolo}
                </span>
              </div>
              <button
                onClick={logout}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border-default)",
                  color: "#fca5a5",
                  padding: "4px 10px",
                  borderRadius: 5,
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  transition: "background 120ms, border-color 120ms",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.10)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(239,68,68,0.30)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-default)";
                }}
              >
                ESCI
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
        var t = localStorage.getItem('maintai_theme');
        if (t) document.documentElement.setAttribute('data-theme', t);
      } catch(e) {}
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

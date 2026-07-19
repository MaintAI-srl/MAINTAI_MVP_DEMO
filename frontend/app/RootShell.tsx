"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AuthProvider, useAuth } from "./lib/auth";
import { moduleForPath } from "./lib/modules";
import WeatherWidget from "./components/WeatherWidget";
import NotificationPanel from "./components/NotificationPanel";
import GlobalQuickTicket from "./components/GlobalQuickTicket";
import QuickTicketModal from "./components/QuickTicketModal";
import GuideBot from "./components/GuideBot";
import InstallPrompt from "./components/InstallPrompt";
import TenantContextSwitcher from "./components/TenantContextSwitcher";
import { VERSION } from "./lib/version";
import { getVisibleNavGroups, PAGE_LABELS } from "./lib/navigation";
import { Toaster } from "@/components/ui/sonner";
import { BackendStatus } from "./components/BackendStatus";
import ViewportController, {
  detectDeviceClass,
  isCompactDevice,
} from "./components/ViewportController";
import {
  LogOut,
  Moon,
  Sun,
} from "lucide-react";

// Fonts now loaded above individually

function GlobalOfflineIndicator() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    // TODO(sec-04): revisione umana - pattern accettato per init sincrona da DOM API all'mount
    // eslint-disable-next-line react-hooks/set-state-in-effect -- leggo navigator.onLine all'mount per init state; non triggera re-render cascante
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
  const { isAuthenticated, logout, user, isModuleEnabled, modulesLoaded } = useAuth();
  const [time, setTime] = useState("");
  const [theme, setTheme] = useState("light");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const compactDeviceRef = useRef(false);

  useLayoutEffect(() => {
    const root = document.documentElement;
    let resizeFrame = 0;

    const applyDeviceClass = () => {
      const deviceClass = detectDeviceClass();
      const compact = deviceClass !== "desktop";
      const compactModeChanged = compactDeviceRef.current !== compact;

      root.dataset.deviceClass = deviceClass;
      if (!root.dataset.layoutReady || compactModeChanged) {
        // Lo stato del drawer segue la modalità layout, non la sola innerWidth.
        setSidebarOpen(!compact);
      }
      compactDeviceRef.current = compact;
      root.dataset.layoutReady = "true";
    };

    const scheduleDeviceCheck = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(applyDeviceClass);
    };

    applyDeviceClass();
    window.addEventListener("resize", scheduleDeviceCheck);
    window.addEventListener("orientationchange", scheduleDeviceCheck);
    window.visualViewport?.addEventListener("resize", scheduleDeviceCheck);

    return () => {
      window.cancelAnimationFrame(resizeFrame);
      window.removeEventListener("resize", scheduleDeviceCheck);
      window.removeEventListener("orientationchange", scheduleDeviceCheck);
      window.visualViewport?.removeEventListener("resize", scheduleDeviceCheck);
    };
  }, []);

  // Keep-alive: pinga il backend ogni 8 minuti per evitare cold start su Render free tier
  useEffect(() => {
    if (!isAuthenticated) return;
    const ping = () => fetch(`${process.env.NEXT_PUBLIC_API_BASE ?? "https://maintai-v3.onrender.com"}/health`, { method: "GET", credentials: "include" }).catch(() => {});
    ping();
    const id = setInterval(ping, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [isAuthenticated]);

  // Registra il Service Worker per PWA offline e notifiche push
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" })
        .then((reg) => {
          console.log("[MaintAI SW] Registrato:", reg.scope);
          // Controlla aggiornamenti in background
          reg.update().catch(() => {});
        })
        .catch((err) => { console.warn("[MaintAI SW] Registrazione fallita:", err); });
    }
  }, []);

  const isTecnico = user?.ruolo === "tecnico";
  const isSuperadmin = user?.ruolo === "superadmin";

  const filteredNav = useMemo(() => {
    return getVisibleNavGroups({
      role: user?.ruolo,
      isModuleEnabled,
    });
  }, [isModuleEnabled, user?.ruolo]);

  const firstAvailableHref = filteredNav[0]?.items[0]?.href ?? "/profilo";
  const notificationsEnabled = isModuleEnabled("deadlines") || isModuleEnabled("tickets");

  const toggleSidebar = () => {
    setSidebarOpen((open) => !open);
  };

  const closeSidebarOnMobile = () => {
    if (isCompactDevice()) {
      setSidebarOpen(false);
    }
  };

  // Su mobile la sidebar è un drawer sovrapposto al contenuto: deve partire
  // chiusa al primo caricamento e richiudersi a ogni navigazione, altrimenti
  // copre la pagina con l'overlay. useLayoutEffect evita il flash del drawer
  // aperto prima del paint.
  useLayoutEffect(() => {
    if (isCompactDevice()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- chiusura sincrona del drawer prima del paint su mobile; niente cascata di re-render
      setSidebarOpen(false);
    }
  }, [pathname]);

  useEffect(() => {
    if (isTecnico && (pathname === "/" || pathname === "/dashboard")) {
      router.push("/mobile");
    }
  }, [isTecnico, pathname, router]);

  useEffect(() => {
    const local = localStorage.getItem("maintai_theme");
    const nextTheme = local === "dark" || local === "light" ? local : "light";
    // TODO(sec-04): revisione umana - pattern accettato per init one-shot da storage all'mount
    // eslint-disable-next-line react-hooks/set-state-in-effect -- init theme dal localStorage all'mount; sincrono e senza cascata
    setTheme(nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
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

  // Pagine pubbliche (nessun redirect al login)
  const isPublicPage = pathname === "/login" || pathname.startsWith("/check/");

  useEffect(() => {
    if (!isAuthenticated && !isPublicPage) {
      router.push("/login");
    }
  }, [isAuthenticated, pathname, router, isPublicPage]);

  useEffect(() => {
    if (!isAuthenticated || isPublicPage || !modulesLoaded) return;
    // Il superadmin mantiene l'accesso alle pagine /admin anche quando il
    // tenant nel contesto ha il modulo corrispondente disattivato.
    if (isSuperadmin && pathname.startsWith("/admin")) return;
    const moduleId = moduleForPath(pathname);
    if (moduleId && !isModuleEnabled(moduleId)) {
      router.replace(firstAvailableHref);
    }
  }, [firstAvailableHref, isAuthenticated, isModuleEnabled, isPublicPage, isSuperadmin, modulesLoaded, pathname, router]);

  if (!isAuthenticated || isPublicPage) {
    return <main style={{ height: "100vh", width: "100vw" }}>{children}</main>;
  }

  // Layout mobile-first per storico interventi — full screen, no sidebar
  if (pathname.startsWith("/storico/")) {
    return (
      <div style={{ minHeight: "100dvh", background: "var(--surface-0)", color: "var(--text-primary)" }}>
        {children}
      </div>
    );
  }

  // Layout dedicato per la pagina mobile tecnici — full-screen, no sidebar, no scroll pagina
  if (pathname === "/mobile") {
    return (
      <div style={{
        display: "flex", flexDirection: "column", height: "100dvh", overflow: "hidden",
        background: "radial-gradient(1200px 500px at 50% -10%, rgba(10,132,255,0.10), transparent 60%), #0B0F1A",
      }}>
        {/* Topbar in vetro smerigliato */}
        <header style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 16px",
          paddingTop: "calc(10px + env(safe-area-inset-top, 0px))",
          background: "rgba(15,20,35,0.62)",
          backdropFilter: "blur(24px) saturate(1.6)",
          WebkitBackdropFilter: "blur(24px) saturate(1.6)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0, zIndex: 100,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- logo statico piccolo; next/image non porta benefici e complica il layout della topbar */}
            <img src="/logo.png" alt="MaintAI" style={{ width: 28, height: 28, objectFit: "contain", filter: "drop-shadow(0 0 8px rgba(10,132,255,0.45))" }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#F5F5F7", lineHeight: 1, letterSpacing: "-0.02em" }}>MaintAI</div>
              <div style={{ fontSize: 9, color: "#0A84FF", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", marginTop: 2 }}>Campo</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              fontSize: 12, color: "rgba(235,235,245,0.6)", fontWeight: 600,
              maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{user?.username}</span>
            <button
              className="m-press"
              onClick={toggleTheme}
              style={{
                background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)",
                cursor: "pointer", color: "rgba(235,235,245,0.6)",
                width: 34, height: 34, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
              title={theme === "dark" ? "Tema chiaro" : "Tema scuro"}
            >
              {theme === "dark" ? <Sun size={15} strokeWidth={1.8} /> : <Moon size={15} strokeWidth={1.8} />}
            </button>
            <button
              className="m-press"
              onClick={logout}
              aria-label="Esci"
              style={{
                background: "rgba(255,69,58,0.10)", border: "1px solid rgba(255,69,58,0.25)",
                color: "#FF6961", borderRadius: "50%", width: 34, height: 34,
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
              }}
            >
              <LogOut size={15} strokeWidth={2} />
            </button>
          </div>
        </header>
        {/* Contenuto: la pagina gestisce internamente le aree scrollabili */}
        <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {children}
        </main>
      </div>
    );
  }

  const pageLabel = pathname === "/"
    ? "Home"
    : Object.entries(PAGE_LABELS).find(([k]) => pathname.startsWith(k))?.[1] ?? "MaintAI";

  const sectionLabel = filteredNav.find((group) =>
    group.items.some((item) => pathname === item.href || pathname.startsWith(item.href + "/"))
  )?.section ?? (pathname === "/" ? "HOME" : "OPERAZIONI");

  return (
    <div className={`app-shell${sidebarOpen ? " sidebar-open" : ""}`}>

      {/* Sibling del drawer: transform e overflow della sidebar non lo ritagliano. */}
      <button
        type="button"
        className="sidebar-mobile-overlay"
        onClick={() => setSidebarOpen(false)}
        aria-label="Chiudi menu laterale"
        tabIndex={sidebarOpen ? 0 : -1}
      />

      {/* ══════════════════════════════════════════════════════════
          SIDEBAR — NUOVA IDENTITÀ VISIVA
          Ultra-dark glass panel, glow icons, neon accents
          ══════════════════════════════════════════════════════════ */}
      <aside className={`app-sidebar${sidebarOpen ? " open" : ""}`}>
        {/* Ambient top glow */}
        <div style={{ position: "absolute", top: -60, left: "50%", transform: "translateX(-50%)", width: 200, height: 120, background: "radial-gradient(ellipse, rgba(91,143,255,0.18) 0%, transparent 70%)", pointerEvents: "none" }} />
        {/* Scan lines texture */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(91,143,255,0.012) 3px, rgba(91,143,255,0.012) 4px)", pointerEvents: "none", zIndex: 0 }} />

        {/* ── LOGO ──────────────────────────────────────── */}
        <Link href="/" className="sidebar-logo" style={{ textDecoration: "none", zIndex: 1 }} onClick={closeSidebarOnMobile}>
          {/* Logo con glow */}
          <div className="sidebar-logo-icon" style={{ background: "var(--cobalt-dim)", border: "1px solid var(--cobalt-border)", boxShadow: "var(--glow-cobalt)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- logo statico piccolo della sidebar; next/image non porta benefici */}
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
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={closeSidebarOnMobile}
                      className={active ? "nav-item active" : "nav-item"}
                    >
                      <span className="nav-icon">
                        <Icon size={14} strokeWidth={1.8} />
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
          {isSuperadmin && <TenantContextSwitcher defaultTenantName={user?.tenant_nome} />}

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
              v{VERSION}
            </span>
          </div>
        </div>
      </aside>

      <button
        type="button"
        className="sidebar-menu-tab"
        onClick={toggleSidebar}
        aria-label={sidebarOpen ? "Nascondi menu laterale" : "Mostra menu laterale"}
        aria-expanded={sidebarOpen}
      >
        <span>MENU</span>
      </button>

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
              onClick={toggleSidebar}
              aria-label={sidebarOpen ? "Nascondi menu" : "Apri menu"}
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
          <div className="topbar-right">
            {isModuleEnabled("tickets") && (
              <div className="topbar-quick-ticket"><GlobalQuickTicket /></div>
            )}

            <div className="topbar-divider" />

            {notificationsEnabled && (
              <div className="topbar-notifications">
                <NotificationPanel
                  enableScadenze={isModuleEnabled("deadlines")}
                  enableTickets={isModuleEnabled("tickets")}
                />
              </div>
            )}
            {isModuleEnabled("weather") && (
              <div className="topbar-weather">
                <WeatherWidget />
              </div>
            )}

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
            <div className="topbar-user">
              <div className="topbar-user-copy" style={{
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
        <main className="app-content">
          {children}
        </main>
      </div>
    </div>
  );
}


function AppShellExtras() {
  const { isModuleEnabled } = useAuth();

  return (
    <>
      {isModuleEnabled("guide_ai") && <GuideBot />}
      {isModuleEnabled("tickets") && <QuickTicketModal />}
    </>
  );
}



/**
 * Shell applicativa client (provider, layout con sidebar/topbar, extra UI).
 * Renderizzata dentro <body> dal root layout SERVER (app/layout.tsx), che è
 * l'unico proprietario di <html>/<head> e dell'export `viewport` di Next.
 */
export default function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthProvider>
        <AppLayoutContent>{children}</AppLayoutContent>
        <AppShellExtras />
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
      <ViewportController />
      <InstallPrompt />
      <BackendStatus />
    </>
  );
}

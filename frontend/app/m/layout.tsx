"use client";

/**
 * Shell dell'app mobile /m — semi-indipendente dal layout desktop.
 * Header compatto + bottom tab bar stile app nativa. Le pagine gestiscono
 * internamente le proprie aree scrollabili (.m-scroll).
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useCallback } from "react";
import { useAuth } from "../lib/auth";
import { apiGet } from "../lib/api";
import {
  Home, ClipboardList, Plus, CalendarCheck, Stethoscope, UserRound,
} from "lucide-react";
import { C, isDispatchAlertTicket, triggerEmergencyAlert, useTecnicoId, type Ticket } from "./shared";

const TABS = [
  { href: "/m",          label: "Home",     Icon: Home },
  { href: "/m/ticket",   label: "Ticket",   Icon: ClipboardList },
  { href: "/m/nuovo",    label: "Nuovo",    Icon: Plus, prominent: true },
  { href: "/m/piano",    label: "Piano",    Icon: CalendarCheck },
  { href: "/m/diagnosi", label: "Diagnosi", Icon: Stethoscope },
] as const;

/**
 * Watcher globale emergenze: qualunque tab sia aperta, una nuova emergenza
 * assegnata al tecnico fa suonare l'allarme (audio + vibrazione + toast).
 */
function useEmergencyWatcher() {
  const tecnicoId = useTecnicoId();
  const seenIds = useRef<Set<number>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    if (tecnicoId === null || tecnicoId === -1) return;
    const poll = async () => {
      try {
        const d = await apiGet<{ items?: Ticket[] }>(`/tickets?tecnico_id=${tecnicoId}&limit=50`);
        const items = d.items ?? [];
        items.forEach(t => {
          if (!isDispatchAlertTicket(t)) return;
          if (!seenIds.current.has(t.id)) {
            seenIds.current.add(t.id);
            // Primo giro: registra senza allarmare (emergenze già note)
            if (primed.current) triggerEmergencyAlert(t.titolo);
          }
        });
        primed.current = true;
      } catch { /* silenzioso — non disturbare il tecnico con errori di rete */ }
    };
    poll();
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, [tecnicoId]);
}

/** Larghezza di riferimento del design /m (telefono portrait tipico). */
const M_DESIGN_WIDTH = 430;

/**
 * Auto-scala l'intera shell in proporzione alla viewport reale del telefono.
 * Molti Android dichiarano una viewport CSS larga (es. 610px su schermi 1220px
 * con DPR 2.0): senza correzione la UI, tarata su ~430px, risulta fisicamente
 * il 30-40% più piccola. Qui si applica `zoom = latoCorto / 430` SOLO dentro
 * .m-shell — nessuna manipolazione dei meta viewport, resa deterministica.
 * Sui telefoni con viewport standard (≤430px) il fattore resta 1.
 */
function useMobileScale(shellRef: React.RefObject<HTMLDivElement | null>) {
  const apply = useCallback(() => {
    const el = shellRef.current;
    if (!el) return;
    // Il lato corto è la larghezza in portrait e resta stabile in landscape
    const shortSide = Math.min(window.innerWidth, window.innerHeight);
    const isPhone = document.documentElement.dataset.deviceClass === "mobile";
    const zoom = isPhone ? Math.min(Math.max(shortSide / M_DESIGN_WIDTH, 1), 1.9) : 1;
    el.style.setProperty("--m-zoom", zoom.toFixed(3));
  }, [shellRef]);

  useEffect(() => {
    // Browser senza supporto `zoom` (Firefox < 126): nessuna scala, la CSS
    // ha fallback --m-zoom:1 e la shell resta identica a prima.
    if (typeof CSS === "undefined" || !CSS.supports("zoom", "2")) return;
    const delayed = () => window.setTimeout(apply, 350);
    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", delayed);
    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", delayed);
    };
  }, [apply]);
}

export default function MobileAppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, user } = useAuth();
  const shellRef = useRef<HTMLDivElement>(null);

  useEmergencyWatcher();
  useMobileScale(shellRef);

  useEffect(() => {
    if (!isAuthenticated) router.push("/login");
  }, [isAuthenticated, router]);

  if (!isAuthenticated) return null;

  const isActive = (href: string) =>
    href === "/m" ? pathname === "/m" : pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="m-shell" ref={shellRef}>
      {/* ── Header ── */}
      <header className="m-appbar">
        <Link href="/m" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- logo statico piccolo; next/image non porta benefici nella topbar */}
          <img src="/logo.png" alt="MaintAI" style={{ width: 30, height: 30, objectFit: "contain", filter: "drop-shadow(0 0 8px rgba(10,132,255,0.45))" }} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.text, lineHeight: 1, letterSpacing: "-0.02em" }}>MaintAI</div>
            <div style={{ fontSize: 10, color: C.blue, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", marginTop: 2 }}>Campo</div>
          </div>
        </Link>
        <Link
          href="/m/profilo"
          className="m-press"
          aria-label="Profilo"
          style={{
            display: "flex", alignItems: "center", gap: 8, textDecoration: "none",
            background: isActive("/m/profilo") ? "rgba(10,132,255,0.14)" : "rgba(255,255,255,0.06)",
            border: `1px solid ${isActive("/m/profilo") ? "rgba(10,132,255,0.4)" : C.border}`,
            borderRadius: 99, padding: "7px 12px 7px 9px",
          }}
        >
          <UserRound size={18} strokeWidth={2} color={isActive("/m/profilo") ? C.blue : (C.text2 as string)} />
          <span style={{
            fontSize: 13, color: C.text2, fontWeight: 700,
            maxWidth: 96, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{user?.username}</span>
        </Link>
      </header>

      {/* ── Contenuto ── */}
      <main className="m-content">
        {children}
      </main>

      {/* ── Bottom tab bar ── */}
      <nav className="m-tabbar" aria-label="Navigazione app">
        {TABS.map(tab => {
          const active = isActive(tab.href);
          if ("prominent" in tab && tab.prominent) {
            return (
              <Link key={tab.href} href={tab.href} className="m-tab m-tab-fab" aria-label={tab.label} aria-current={active ? "page" : undefined}>
                <span className="m-tab-fab-circle">
                  <tab.Icon size={26} strokeWidth={2.4} />
                </span>
                <span className="m-tab-label">{tab.label}</span>
              </Link>
            );
          }
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`m-tab${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <tab.Icon size={24} strokeWidth={active ? 2.3 : 1.9} />
              <span className="m-tab-label">{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

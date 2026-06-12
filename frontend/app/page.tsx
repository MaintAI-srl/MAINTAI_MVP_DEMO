"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useMemo } from "react";
import { ArrowUpRight, ChevronRight, Sparkles } from "lucide-react";
import { useAuth } from "./lib/auth";
import { getVisibleNavGroups } from "./lib/navigation";

const TILE_ACCENTS = [
  { from: "#5b8fff", to: "#6c63ff", glow: "rgba(91,143,255,0.24)" },
  { from: "#10d9b0", to: "#06b6d4", glow: "rgba(16,217,176,0.22)" },
  { from: "#f6a233", to: "#f97316", glow: "rgba(246,162,51,0.20)" },
  { from: "#f05252", to: "#fb7185", glow: "rgba(240,82,82,0.18)" },
  { from: "#9b78ff", to: "#5b8fff", glow: "rgba(155,120,255,0.20)" },
  { from: "#22d3a0", to: "#84cc16", glow: "rgba(34,211,160,0.18)" },
];

const SECTION_HINTS: Record<string, string> = {
  DASHBOARD: "Vista generale",
  OPERAZIONI: "Lavoro quotidiano",
  RISORSE: "Anagrafiche e asset",
  IMPOSTAZIONI: "Amministrazione",
};

export default function Home() {
  const { user, isModuleEnabled } = useAuth();

  const navGroups = useMemo(() => {
    return getVisibleNavGroups({
      role: user?.ruolo,
      isModuleEnabled,
    });
  }, [isModuleEnabled, user?.ruolo]);

  const allItems = navGroups.flatMap((group) => group.items.map((item) => ({ ...item, section: group.section })));
  const featuredItems = allItems.slice(0, 3);

  return (
    <div className="home-launchpad">
      <section className="home-hero">
        <div className="home-hero-copy">
          <div className="home-kicker">
            <Sparkles size={14} strokeWidth={1.8} />
            Centro operativo MaintAI
          </div>
          <h1>Ciao, {user?.username ?? "utente"}.</h1>
          <p>Le funzioni principali sono pronte in formato icona, grandi e immediate come sulla vista mobile.</p>
        </div>

        <div className="home-feature-strip" aria-label="Azioni rapide">
          {featuredItems.map((item, index) => {
            const Icon = item.icon;
            const accent = TILE_ACCENTS[index % TILE_ACCENTS.length];

            return (
              <Link
                key={item.href}
                href={item.href}
                className="home-feature-link"
                style={{ "--tile-from": accent.from, "--tile-to": accent.to, "--tile-glow": accent.glow } as CSSProperties}
              >
                <span className="home-feature-icon">
                  <Icon size={24} strokeWidth={1.9} />
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.section}</small>
                </span>
                <ChevronRight size={16} strokeWidth={2.2} />
              </Link>
            );
          })}
        </div>
      </section>

      <div className="home-sections">
        {navGroups.map((group, groupIndex) => (
          <section key={group.section} className="home-section">
            <div className="home-section-heading">
              <div>
                <span>{SECTION_HINTS[group.section] ?? "Funzioni"}</span>
                <h2>{group.section}</h2>
              </div>
              <div className="home-section-count">{group.items.length}</div>
            </div>

            <div className="home-app-grid">
              {group.items.map((item, itemIndex) => {
                const Icon = item.icon;
                const accent = TILE_ACCENTS[(groupIndex * 3 + itemIndex) % TILE_ACCENTS.length];

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="home-app-tile"
                    style={{ "--tile-from": accent.from, "--tile-to": accent.to, "--tile-glow": accent.glow } as CSSProperties}
                  >
                    <span className="home-app-icon">
                      <Icon size={36} strokeWidth={1.75} />
                    </span>
                    <span className="home-app-title">{item.label}</span>
                    <span className="home-app-arrow" aria-hidden="true">
                      <ArrowUpRight size={15} strokeWidth={2.2} />
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

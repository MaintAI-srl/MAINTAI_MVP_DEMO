"use client";

/**
 * Profilo utente dell'app mobile /m — dati account, passaggio alla
 * versione desktop (con memoria della scelta) e logout.
 */

import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { VERSION } from "../../lib/version";
import { LogOut, Monitor, UserRound, Building2, BadgeCheck } from "lucide-react";
import { C, glass, IconBadge } from "../shared";

export default function MobileProfiloPage() {
  const router = useRouter();
  const { user, logout } = useAuth();

  function goDesktop() {
    // Memorizza la preferenza: RootShell non rimanderà più su /m in automatico
    localStorage.setItem("maintai_force_desktop", "true");
    router.push("/ticket");
  }

  return (
    <div className="m-page m-scroll" style={{ padding: "16px 16px 24px", gap: 12 }}>

      <div style={{ fontWeight: 800, fontSize: "clamp(22px, 6vw, 26px)", color: C.text, letterSpacing: "-0.02em", marginBottom: 4 }}>
        Profilo
      </div>

      {/* Card utente */}
      <div className="m-fade-up" style={{ ...glass, padding: 18, display: "flex", alignItems: "center", gap: 14 }}>
        <IconBadge Icon={UserRound} color={C.blue} size={56} iconSize={26} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 19, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user?.username}
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 5, marginTop: 5,
            fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
            color: C.blue, background: `${C.blue}1a`, border: `1px solid ${C.blue}40`,
            padding: "3px 10px", borderRadius: 99,
          }}>
            <BadgeCheck size={13} strokeWidth={2.4} /> {user?.ruolo}
          </div>
        </div>
      </div>

      {/* Card tenant */}
      {user?.tenant_nome && (
        <div className="m-fade-up m-d1" style={{ ...glass, padding: "15px 18px", display: "flex", alignItems: "center", gap: 13 }}>
          <IconBadge Icon={Building2} color={C.teal} size={44} iconSize={20} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: C.text3, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>Azienda</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user.tenant_nome}
            </div>
          </div>
        </div>
      )}

      {/* Versione desktop */}
      <button
        className="m-press m-fade-up m-d2"
        onClick={goDesktop}
        style={{
          ...glass, padding: "16px 18px", cursor: "pointer", textAlign: "left",
          display: "flex", alignItems: "center", gap: 13, width: "100%",
        }}
      >
        <IconBadge Icon={Monitor} color={C.purple} size={44} iconSize={20} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: C.text }}>Versione desktop</div>
          <div style={{ fontSize: 13, color: C.text3, marginTop: 2, lineHeight: 1.4 }}>
            Passa al gestionale completo. Torni qui aprendo /m.
          </div>
        </div>
      </button>

      {/* Logout */}
      <button
        className="m-press m-fade-up m-d3"
        onClick={logout}
        style={{
          padding: "17px 18px", borderRadius: 20, cursor: "pointer", width: "100%",
          background: "rgba(255,69,58,0.10)", border: "1.5px solid rgba(255,69,58,0.32)",
          color: "#FF6961", fontWeight: 800, fontSize: 16,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
        }}
      >
        <LogOut size={19} strokeWidth={2.2} /> Esci
      </button>

      <div style={{ textAlign: "center", fontSize: 12, color: C.text3, fontFamily: "var(--font-mono)", marginTop: 8 }}>
        MaintAI Campo · v{VERSION}
      </div>
    </div>
  );
}

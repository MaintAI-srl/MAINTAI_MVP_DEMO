"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { apiGet, apiPost, clearTauriToken, isTauri, getTauriToken } from "./api";

type User = {
  username: string;
  ruolo: string;
  userid?: number;
  tenant_id?: number;
  tenant_nome?: string;
};

interface AuthContextType {
  user: User | null;
  login: (username: string, ruolo: string, userid?: number, tenant_id?: number, tenant_nome?: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  login: () => {},
  logout: () => {},
  isAuthenticated: false,
});

export const useAuth = () => useContext(AuthContext);

const META_KEYS = ["maintai_username", "maintai_ruolo", "maintai_userid", "maintai_tenant_id", "maintai_tenant_nome"] as const;

function saveUserMeta(user: User) {
  localStorage.setItem("maintai_username", user.username);
  localStorage.setItem("maintai_ruolo", user.ruolo);
  if (user.userid != null) localStorage.setItem("maintai_userid", String(user.userid));
  if (user.tenant_id != null) localStorage.setItem("maintai_tenant_id", String(user.tenant_id));
  if (user.tenant_nome) localStorage.setItem("maintai_tenant_nome", user.tenant_nome);
}

function clearUserMeta() {
  META_KEYS.forEach(k => localStorage.removeItem(k));
  // Rimuove anche l'eventuale JWT in localStorage da versioni precedenti
  localStorage.removeItem("maintai_jwt");
}

function loadUserMeta(): User | null {
  const username = localStorage.getItem("maintai_username");
  const ruolo = localStorage.getItem("maintai_ruolo");
  if (!username || !ruolo) return null;
  const userid = localStorage.getItem("maintai_userid");
  const tenant_id = localStorage.getItem("maintai_tenant_id");
  const tenant_nome = localStorage.getItem("maintai_tenant_nome");
  return {
    username,
    ruolo,
    userid: userid ? parseInt(userid) : undefined,
    tenant_id: tenant_id ? parseInt(tenant_id) : undefined,
    tenant_nome: tenant_nome || undefined,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const loggingOutRef = useRef(false);

  useEffect(() => {
    const meta = loadUserMeta();

    // In Tauri non esistono cookie HttpOnly: se non c'è un JWT in localStorage
    // non ha senso chiamare /auth/me — vai subito al login.
    if (isTauri() && !getTauriToken()) {
      clearUserMeta();
      // TODO(sec-04): revisione umana - pattern accettato per guard di piattaforma (Tauri senza token)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- early-return sincrono per Tauri senza token; non triggera cascata
      setUser(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- early-return sincrono per Tauri senza token; non triggera cascata
      setLoading(false);
      return;
    }

    // Web: il cookie HttpOnly potrebbe essere ancora valido — verifica con /auth/me.
    // Tauri con token presente: verifica che il token non sia scaduto.
    apiGet<{ username: string; ruolo: string; userid?: number; tenant_id?: number; tenant_nome?: string }>("/auth/me")
      .then(data => {
        const restored: User = {
          username: data.username,
          ruolo: data.ruolo,
          userid: data.userid ?? meta?.userid,
          tenant_id: data.tenant_id ?? meta?.tenant_id,
          tenant_nome: data.tenant_nome ?? meta?.tenant_nome,
        };
        setUser(restored);
        saveUserMeta(restored);
      })
      .catch(() => {
        // Token scaduto o non valido
        clearUserMeta();
        clearTauriToken();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback((username: string, ruolo: string, userid?: number, tenant_id?: number, tenant_nome?: string) => {
    const u: User = { username, ruolo, userid, tenant_id, tenant_nome };
    saveUserMeta(u);
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    try {
      await apiPost("/auth/logout");
      // Pulisce la cache del service worker per evitare accesso offline a dati tenant dopo logout
      if (typeof window !== 'undefined' && 'caches' in window) {
        try {
          const cacheKeys = await window.caches.keys();
          await Promise.all(cacheKeys.map(key => window.caches.delete(key)));
        } catch { /* ignora errori caches API - non critico */ }
      }
    } catch {
      // Il backend potrebbe non essere raggiungibile — procedi comunque
    }
    clearUserMeta();
    clearTauriToken();
    setUser(null);
    loggingOutRef.current = false;
  }, []);

  useEffect(() => {
    const handle = () => logout();
    window.addEventListener("maintai:unauthorized", handle);
    return () => window.removeEventListener("maintai:unauthorized", handle);
  }, [logout]);

  if (loading) return null;

  return (
    <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

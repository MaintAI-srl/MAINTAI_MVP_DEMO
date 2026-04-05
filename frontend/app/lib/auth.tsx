"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

type User = {
  username: string;
  ruolo: string;
  token: string;
  userid?: number;
  tenant_id?: number;
  tenant_nome?: string;
  isDemo?: boolean;
};

interface AuthContextType {
  user: User | null;
  login: (token: string, username: string, ruolo: string, userid?: number, tenant_id?: number, tenant_nome?: string, isDemo?: boolean) => void;
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem("maintai_jwt");
    const savedUsername = localStorage.getItem("maintai_username");
    const savedRuolo = localStorage.getItem("maintai_ruolo");
    const savedUserId = localStorage.getItem("maintai_userid");
    const savedTenantId = localStorage.getItem("maintai_tenant_id");
    const savedTenantNome = localStorage.getItem("maintai_tenant_nome");
    const savedIsDemo = localStorage.getItem("maintai_is_demo") === "true";

    if (savedToken && savedUsername && savedRuolo) {
      if (isTokenExpired(savedToken)) {
        localStorage.removeItem("maintai_jwt");
        localStorage.removeItem("maintai_username");
        localStorage.removeItem("maintai_ruolo");
        localStorage.removeItem("maintai_userid");
        localStorage.removeItem("maintai_tenant_id");
        localStorage.removeItem("maintai_tenant_nome");
      } else {
        setUser({
          token: savedToken,
          username: savedUsername,
          ruolo: savedRuolo,
          userid: savedUserId ? parseInt(savedUserId) : undefined,
          tenant_id: savedTenantId ? parseInt(savedTenantId) : undefined,
          tenant_nome: savedTenantNome || undefined,
          isDemo: savedIsDemo,
        });
      }
    }
    setLoading(false);
  }, []);

  const login = (token: string, username: string, ruolo: string, userid?: number, tenant_id?: number, tenant_nome?: string, isDemo?: boolean) => {
    localStorage.setItem("maintai_jwt", token);
    localStorage.setItem("maintai_username", username);
    localStorage.setItem("maintai_ruolo", ruolo);
    if (userid) localStorage.setItem("maintai_userid", String(userid));
    if (tenant_id) localStorage.setItem("maintai_tenant_id", String(tenant_id));
    if (tenant_nome) localStorage.setItem("maintai_tenant_nome", tenant_nome);
    if (isDemo) localStorage.setItem("maintai_is_demo", "true");
    else localStorage.removeItem("maintai_is_demo");
    setUser({ token, username, ruolo, userid, tenant_id, tenant_nome, isDemo });
  };

  const logout = useCallback(() => {
    localStorage.removeItem("maintai_jwt");
    localStorage.removeItem("maintai_username");
    localStorage.removeItem("maintai_ruolo");
    localStorage.removeItem("maintai_userid");
    localStorage.removeItem("maintai_tenant_id");
    localStorage.removeItem("maintai_tenant_nome");
    localStorage.removeItem("maintai_is_demo");
    setUser(null);
  }, []);

  useEffect(() => {
    window.addEventListener("maintai:unauthorized", logout);
    return () => window.removeEventListener("maintai:unauthorized", logout);
  }, [logout]);

  if (loading) return null;

  return (
    <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

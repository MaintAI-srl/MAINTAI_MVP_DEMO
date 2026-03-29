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
};

interface AuthContextType {
  user: User | null;
  login: (token: string, username: string, ruolo: string, userid?: number) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  login: (t, u, r, id) => {},
  logout: () => {},
  isAuthenticated: false,
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check localStorage on mount
    const savedToken = localStorage.getItem("maintai_jwt");
    const savedUsername = localStorage.getItem("maintai_username");
    const savedRuolo = localStorage.getItem("maintai_ruolo");
    const savedUserId = localStorage.getItem("maintai_userid");

    if (savedToken && savedUsername && savedRuolo) {
      if (isTokenExpired(savedToken)) {
        // Token scaduto: pulisce storage senza redirect esplicito
        localStorage.removeItem("maintai_jwt");
        localStorage.removeItem("maintai_username");
        localStorage.removeItem("maintai_ruolo");
        localStorage.removeItem("maintai_userid");
      } else {
        setUser({
          token: savedToken,
          username: savedUsername,
          ruolo: savedRuolo,
          userid: savedUserId ? parseInt(savedUserId) : undefined,
        });
      }
    }
    setLoading(false);
  }, []);

  const login = (token: string, username: string, ruolo: string, userid?: number) => {
    localStorage.setItem("maintai_jwt", token);
    localStorage.setItem("maintai_username", username);
    localStorage.setItem("maintai_ruolo", ruolo);
    if (userid) localStorage.setItem("maintai_userid", String(userid));
    setUser({ token, username, ruolo, userid });
  };

  const logout = useCallback(() => {
    localStorage.removeItem("maintai_jwt");
    localStorage.removeItem("maintai_username");
    localStorage.removeItem("maintai_ruolo");
    localStorage.removeItem("maintai_userid");
    setUser(null);
  }, []);

  // Ascolta eventi 401 lanciati da api.ts
  useEffect(() => {
    window.addEventListener("maintai:unauthorized", logout);
    return () => window.removeEventListener("maintai:unauthorized", logout);
  }, [logout]);

  if (loading) return null; // Avoid flicker

  return (
    <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

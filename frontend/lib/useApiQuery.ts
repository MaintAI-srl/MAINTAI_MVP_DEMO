/**
 * useApiQuery — Hook leggero per data fetching con caching, loading e refetch.
 *
 * Alternativa zero-dependency a TanStack Query, pensata per MaintAI.
 * Benefici:
 * - Caching in-memoria con TTL configurabile
 * - Stato loading/error/data unificato
 * - Refetch manuale + automatico su focus/visibilità
 * - Invalidazione globale per chiave (utile dopo mutazioni)
 * - Nessuna dipendenza esterna
 *
 * Uso:
 *   const { data, loading, error, refetch } = useApiQuery<Ticket[]>("/tickets?page=1");
 *   const { data } = useApiQuery<Asset[]>("/assets", { staleTime: 60000 });
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { apiGet } from "../app/lib/api";

// ── Cache globale in-memoria ─────────────────────────────────────────────────
type CacheEntry<T = unknown> = {
  data: T;
  timestamp: number;
};

const _cache = new Map<string, CacheEntry>();
// Listeners per invalidazione globale (pattern pub/sub)
const _invalidationListeners = new Map<string, Set<() => void>>();

/**
 * Invalida tutte le query che iniziano con il prefisso dato.
 * Esempio: invalidateQueries("/tickets") invalida "/tickets?page=1", "/tickets?page=2", ecc.
 */
export function invalidateQueries(keyPrefix: string): void {
  // Rimuovi dalla cache
  for (const key of _cache.keys()) {
    if (key.startsWith(keyPrefix)) {
      _cache.delete(key);
    }
  }
  // Notifica tutti i listener registrati per chiavi corrispondenti
  for (const [key, listeners] of _invalidationListeners.entries()) {
    if (key.startsWith(keyPrefix)) {
      for (const fn of listeners) {
        fn();
      }
    }
  }
}

// ── Opzioni ──────────────────────────────────────────────────────────────────
type UseApiQueryOptions = {
  /** Tempo in ms prima che i dati diventino stale (default: 30s) */
  staleTime?: number;
  /** Se false, la query non parte automaticamente (default: true) */
  enabled?: boolean;
  /** Se true, refetch quando il tab torna visibile (default: true) */
  refetchOnWindowFocus?: boolean;
};

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useApiQuery<T>(
  path: string | null,
  options: UseApiQueryOptions = {},
) {
  const {
    staleTime = 30_000,
    enabled = true,
    refetchOnWindowFocus = true,
  } = options;

  const [data, setData] = useState<T | undefined>(() => {
    if (!path) return undefined;
    const cached = _cache.get(path);
    if (cached && Date.now() - cached.timestamp < staleTime) {
      return cached.data as T;
    }
    return undefined;
  });
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState<string | null>(null);

  // Ref per evitare stale closure su path
  const pathRef = useRef(path);
  // TODO(sec-04): revisione umana - questo e' il pattern raccomandato da React per ref che seguono un valore
  // eslint-disable-next-line react-hooks/refs -- aggiornamento ref durante render: pattern documentato per evitare stale closure senza useEffect
  pathRef.current = path;

  const fetchData = useCallback(async () => {
    const currentPath = pathRef.current;
    if (!currentPath) return;

    // Controlla cache prima del fetch
    const cached = _cache.get(currentPath);
    if (cached && Date.now() - cached.timestamp < staleTime) {
      setData(cached.data as T);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await apiGet<T>(currentPath);
      _cache.set(currentPath, { data: result, timestamp: Date.now() });
      // Solo se siamo ancora sulla stessa query
      if (pathRef.current === currentPath) {
        setData(result);
        setLoading(false);
      }
    } catch (err: unknown) {
      if (pathRef.current === currentPath) {
        const msg = err instanceof Error ? err.message : "Errore sconosciuto";
        setError(msg);
        setLoading(false);
      }
    }
  }, [staleTime]);

  // Refetch forzato (ignora cache)
  const refetch = useCallback(async () => {
    const currentPath = pathRef.current;
    if (!currentPath) return;
    _cache.delete(currentPath);
    await fetchData();
  }, [fetchData]);

  // Fetch iniziale
  useEffect(() => {
    if (!enabled || !path) return;
    fetchData();
  }, [path, enabled, fetchData]);

  // Refetch su visibilità tab
  useEffect(() => {
    if (!refetchOnWindowFocus || !enabled || !path) return;
    function onFocus() {
      const cached = _cache.get(pathRef.current || "");
      if (!cached || Date.now() - cached.timestamp > staleTime) {
        fetchData();
      }
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetchOnWindowFocus, enabled, path, staleTime, fetchData]);

  // Iscrizione a invalidazione globale
  useEffect(() => {
    if (!path) return;
    const listeners = _invalidationListeners.get(path) || new Set();
    const handler = () => {
      _cache.delete(path);
      fetchData();
    };
    listeners.add(handler);
    _invalidationListeners.set(path, listeners);
    return () => {
      listeners.delete(handler);
      if (listeners.size === 0) {
        _invalidationListeners.delete(path);
      }
    };
  }, [path, fetchData]);

  return { data, loading, error, refetch };
}

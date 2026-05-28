export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? (process.env.NODE_ENV === "production" ? "/api" : "https://maintai-v3.onrender.com");

/** True quando l'app gira dentro Tauri (desktop). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Legge il JWT da localStorage (usato solo in modalità Tauri). */
export function getTauriToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("maintai_jwt");
}

/** Salva il JWT in localStorage (chiamato al login in modalità Tauri). */
export function saveTauriToken(token: string) {
  localStorage.setItem("maintai_jwt", token);
}

/** Rimuove il JWT da localStorage (chiamato al logout in modalità Tauri). */
export function clearTauriToken() {
  localStorage.removeItem("maintai_jwt");
}

type RequestOptions = Omit<RequestInit, "method" | "body">;

const DEFAULT_TIMEOUT_MS = 30_000;

// Endpoint che chiamano AI (OpenAI) — timeout lungo
const SLOW_ENDPOINTS: RegExp[] = [
  /\/planning\/generate/,
  /\/planning\/confirm/,
  /\/manuali\/\d+\/analisi/,
  /\/problem-analysis/,
  /\/diagnostic/,
  /\/guide\/chat/,
  /\/piani-manutenzione.*import/,
  /\/failure\/tickets\/\d+\/analyze/,
  /\/documenti\/\d+\/analizza-esploso/,
  /\/documenti\/\d+\/genera-infografica/,
];

function timeoutForPath(path: string): number {
  if (/\/planning\/generate/.test(path)) return 240_000;  // 4 min: cold start Render + OpenAI
  return SLOW_ENDPOINTS.some(re => re.test(path)) ? 120_000 : DEFAULT_TIMEOUT_MS;
}

function shouldDispatchUnauthorized(path: string): boolean {
  return path !== "/auth/me" && path !== "/auth/logout";
}

function dispatchDataChanged(method: string, path: string) {
  if (typeof window === "undefined") return;
  if (method === "GET") return;
  window.dispatchEvent(new CustomEvent("maintai:data-changed", { detail: { method, path, at: Date.now() } }));
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const url = `${API_BASE}${path}`;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutForPath(path));

  // Supporto per il cambio contesto tenant (solo superadmin)
  const extraHeaders: Record<string, string> = {};
  if (typeof window !== "undefined") {
    const tenantContext = localStorage.getItem("maintai_tenant_context");
    if (tenantContext) {
      extraHeaders["X-Tenant-Id"] = tenantContext;
    }
    // In modalità Tauri i cookie HttpOnly non funzionano → usa Bearer token
    if (isTauri()) {
      const token = getTauriToken();
      if (token) extraHeaders["Authorization"] = `Bearer ${token}`;
    }
  }

  const init: RequestInit = {
    method,
    credentials: "include",   // invia il cookie HttpOnly maintai_jwt (web)
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
      ...options.headers,
    },
    signal: controller.signal,
    ...options,
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, init);
    clearTimeout(id);

    if (!res.ok) {
      if (res.status === 401 && shouldDispatchUnauthorized(path)) {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("maintai:unauthorized"));
        }
      }
      let message = `HTTP ${res.status}: ${res.statusText}`;
      try {
        const err = await res.json();
        if (err?.detail) message = Array.isArray(err.detail) ? err.detail.map((d: { msg?: string }) => d.msg ?? JSON.stringify(d)).join("; ") : String(err.detail);
        else if (err?.message) message = String(err.message);
      } catch {
        // ignora errori di parsing del body
      }
      throw new Error(message);
    }

    dispatchDataChanged(method, path);

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;

  } catch (error: unknown) {
    clearTimeout(id);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Il server ha impiegato troppo tempo a rispondere. Riprova (Render potrebbe essere in avvio).");
    }
    throw error;
  }
}

export function apiGet<T>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>("GET", path, undefined, options);
}

export function apiPost<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  return request<T>("POST", path, body, options);
}

export function apiPatch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  return request<T>("PATCH", path, body, options);
}

export function apiPut<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  return request<T>("PUT", path, body, options);
}

export function apiDelete<T>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>("DELETE", path, undefined, options);
}

/** Helper per upload multipart (no Content-Type automatico, il browser lo imposta) */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 120000); // 2 min per PDF grossi

  const extraHeaders: Record<string, string> = {};
  if (typeof window !== "undefined") {
    const tenantContext = localStorage.getItem("maintai_tenant_context");
    if (tenantContext) {
      extraHeaders["X-Tenant-Id"] = tenantContext;
    }
    if (isTauri()) {
      const token = getTauriToken();
      if (token) extraHeaders["Authorization"] = `Bearer ${token}`;
    }
  }

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      credentials: "include",   // invia il cookie HttpOnly maintai_jwt (web)
      headers: extraHeaders,
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(id);

    if (!res.ok) {
      if (res.status === 401 && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("maintai:unauthorized"));
      }
      let message = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        if (err?.detail) message = Array.isArray(err.detail) ? err.detail.map((d: { msg?: string }) => d.msg ?? JSON.stringify(d)).join("; ") : String(err.detail);
      } catch {}
      throw new Error(message);
    }
    dispatchDataChanged("POST", path);
    return res.json() as Promise<T>;
  } catch (error: unknown) {
    clearTimeout(id);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Upload timeout. Riprova.");
    }
    throw error;
  }
}

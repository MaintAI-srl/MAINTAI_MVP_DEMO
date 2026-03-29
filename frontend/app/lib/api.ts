export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

type RequestOptions = Omit<RequestInit, "method" | "body">;

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const url = `${API_BASE}${path}`;
  
  // Timeout di 30 secondi per default, specialmente importante per AI
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 30000);

  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
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
      let message = `HTTP ${res.status}: ${res.statusText}`;
      try {
        const err = await res.json();
        if (err?.detail) message = String(err.detail);
        else if (err?.message) message = String(err.message);
      } catch {
        // ignora errori di parsing del body
      }
      throw new Error(message);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
    
  } catch (error: any) {
    clearTimeout(id);
    if (error.name === 'AbortError') {
      throw new Error("Il server ha impiegato troppo tempo a rispondere (Timeout 30s). Riprova tra poco.");
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

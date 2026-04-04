export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "https://maintai-v3.onrender.com";

type RequestOptions = Omit<RequestInit, "method" | "body">;

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("maintai_jwt");
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const url = `${API_BASE}${path}`;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 30000);

  const token = getToken();
  const authHeader: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  // Supporto per il cambio contesto tenant (solo superadmin)
  if (typeof window !== "undefined") {
    const tenantContext = localStorage.getItem("maintai_tenant_context");
    if (tenantContext) {
      authHeader["X-Tenant-Id"] = tenantContext;
    }
  }

  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...authHeader,
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
      if (res.status === 401) {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("maintai:unauthorized"));
        }
      }
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
    if (error.name === "AbortError") {
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

/** Helper per upload multipart (no Content-Type automatico, il browser lo imposta) */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const token = getToken();
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 120000); // 2 min per PDF grossi

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
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
        if (err?.detail) message = String(err.detail);
      } catch {}
      throw new Error(message);
    }
    return res.json() as Promise<T>;
  } catch (error: any) {
    clearTimeout(id);
    if (error.name === "AbortError") throw new Error("Upload timeout. Riprova.");
    throw error;
  }
}

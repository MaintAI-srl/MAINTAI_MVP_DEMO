import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_API_BASE = process.env.BACKEND_API_BASE ?? "https://maintai-v3.onrender.com";

const TRUSTED_BROWSER_ORIGINS = new Set([
  "https://maintai-mvp-demo.vercel.app",
  "https://maintai.vercel.app",
  "https://maintai-frontend.vercel.app",
  "https://maintaiv3.vercel.app",
]);

// Origin already accepted by the current Render backend CSRF whitelist.
const BACKEND_ALLOWED_ORIGIN = process.env.BACKEND_ALLOWED_ORIGIN ?? "https://maintai.vercel.app";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

function browserOriginAllowed(request: NextRequest): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return true;

  const origin = request.headers.get("origin");
  if (origin) return TRUSTED_BROWSER_ORIGINS.has(origin);

  const referer = request.headers.get("referer");
  if (!referer) return false;

  try {
    return TRUSTED_BROWSER_ORIGINS.has(new URL(referer).origin);
  } catch {
    return false;
  }
}

async function proxy(request: NextRequest, context: RouteContext): Promise<Response> {
  if (!browserOriginAllowed(request)) {
    return Response.json({ detail: "Richiesta bloccata: Origin non autorizzato." }, { status: 403 });
  }

  const params = await context.params;
  const backendUrl = new URL(params.path?.join("/") ?? "", `${BACKEND_API_BASE}/`);
  backendUrl.search = request.nextUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("accept-encoding");
  headers.delete("connection");
  headers.delete("content-length");
  headers.delete("host");
  headers.set("origin", BACKEND_ALLOWED_ORIGIN);
  headers.set("referer", `${BACKEND_ALLOWED_ORIGIN}/`);

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (!["GET", "HEAD"].includes(request.method)) {
    const body = await request.arrayBuffer();
    if (body.byteLength > 0) {
      init.body = body;
    }
  }

  const backendResponse = await fetch(backendUrl, init);
  const responseHeaders = new Headers(backendResponse.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");

  return new Response(backendResponse.body, {
    status: backendResponse.status,
    statusText: backendResponse.statusText,
    headers: responseHeaders,
  });
}

export {
  proxy as DELETE,
  proxy as GET,
  proxy as HEAD,
  proxy as OPTIONS,
  proxy as PATCH,
  proxy as POST,
  proxy as PUT,
};

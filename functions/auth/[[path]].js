const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const DEFAULT_AUTH_API_BASE = "https://api-worker.logicalsystems-yt.workers.dev";

const proxyAuthRequest = async (request, env, pathname) => {
  const authBase = String(env.AUTH_API_BASE || DEFAULT_AUTH_API_BASE).replace(/\/+$/, "");
  const suffix = pathname.replace(/^\/auth/, "") || "/";
  const targetUrl = `${authBase}${suffix}`;

  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers: {
      "Content-Type": request.headers.get("Content-Type") || "application/json"
    },
    body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.text()
  });

  const body = await upstream.text();
  const headers = new Headers(upstream.headers);
  Object.entries(CORS_HEADERS).forEach(([key, value]) => headers.set(key, value));
  return new Response(body, { status: upstream.status, headers });
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const { pathname } = new URL(request.url);
  return proxyAuthRequest(request, env, pathname);
}

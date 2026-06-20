const TARGET_ORIGIN = Deno.env.get("TARGET_ORIGIN") ??
  "https://realyuyu-yunex-newapi-test.hf.space";

const targetOrigin = new URL(TARGET_ORIGIN);

const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

function buildCorsHeaders(req: Request) {
  const headers = new Headers();

  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    req.headers.get("Access-Control-Request-Headers") ??
      "authorization,content-type,x-requested-with",
  );
  headers.set("Access-Control-Max-Age", "86400");

  return headers;
}

function cleanRequestHeaders(req: Request, proxyUrl: URL) {
  const headers = new Headers(req.headers);

  for (const name of HOP_BY_HOP_HEADERS) {
    headers.delete(name);
  }

  headers.set("Host", targetOrigin.host);
  headers.set("X-Forwarded-Host", proxyUrl.host);
  headers.set("X-Forwarded-Proto", proxyUrl.protocol.replace(":", ""));
  headers.set("X-Forwarded-For", req.headers.get("CF-Connecting-IP") ?? "");

  return headers;
}

function cleanResponseHeaders(upstreamHeaders: Headers, proxyUrl: URL) {
  const headers = new Headers(upstreamHeaders);

  for (const name of HOP_BY_HOP_HEADERS) {
    headers.delete(name);
  }

  const location = headers.get("Location");
  if (location) {
    try {
      const locationUrl = new URL(location, targetOrigin);

      if (locationUrl.origin === targetOrigin.origin) {
        headers.set(
          "Location",
          `${proxyUrl.origin}${locationUrl.pathname}${locationUrl.search}`,
        );
      }
    } catch {
      // Ignore invalid Location headers.
    }
  }

  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "authorization,content-type,x-requested-with");

  return headers;
}

Deno.serve(async (req: Request) => {
  const proxyUrl = new URL(req.url);

  if (proxyUrl.pathname === "/__health") {
    return new Response(
      JSON.stringify({
        status: "ok",
        service: "yunex-deno-proxy",
        target: TARGET_ORIGIN,
        time: new Date().toISOString(),
      }, null, 2),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
      },
    );
  }

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(req),
    });
  }

  const upstreamUrl = new URL(proxyUrl.pathname + proxyUrl.search, targetOrigin);

  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: req.method,
      headers: cleanRequestHeaders(req, proxyUrl),
      body: hasBody ? req.body : undefined,
      redirect: "manual",
    });

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: cleanResponseHeaders(upstreamResponse.headers, proxyUrl),
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        status: "error",
        message: "Proxy request failed",
        target: TARGET_ORIGIN,
        error: error instanceof Error ? error.message : String(error),
      }, null, 2),
      {
        status: 502,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
      },
    );
  }
});

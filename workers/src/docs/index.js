import { assets, catalog, responses } from "./assets.js";
import { assistant } from "./assistant.js";
const staticFiles = {
  "/docs/style.css": [assets.css, "text/css; charset=utf-8"],
  "/docs/app.js": [assets.script, "text/javascript; charset=utf-8"],
  "/docs/routes.json": [
    JSON.stringify(catalog),
    "application/json; charset=utf-8",
  ],
  "/docs/responses.json": [
    JSON.stringify(responses),
    "application/json; charset=utf-8",
  ],
  "/docs/pages.json": [
    JSON.stringify(assets.pages),
    "application/json; charset=utf-8",
  ],
  "/docs/guide.md": [assets.guide, "text/markdown; charset=utf-8"],
  "/docs/favicon.svg": [assets.favicon, "image/svg+xml"],
};
const frontendFiles = new Set(assets.frontendFiles || []);
export async function documentation(request, bindings = {}) {
  const url = new URL(request.url),
    path = url.pathname;
  const landing =
    path === "/" &&
    url.searchParams.get("format") !== "json" &&
    /\btext\/html\b/.test(request.headers.get("Accept") || "");
  // The developer dashboard and its sign-in pages are views of the same app.
  const appPage =
    /^\/(login|register|dashboard(\/(keys|usage|logs|billing|fanbase|account|admin))?|pay\/JKC[A-F0-9]{16})\/?$/.test(
      path,
    );
  if (!landing && !appPage && path !== "/docs" && !path.startsWith("/docs/"))
    return null;
  if (path === "/docs/assistant") return assistant(request, bindings);
  const headers = {
    "Cache-Control": "public, max-age=0, must-revalidate",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    Vary: "Accept",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' https: data: blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    // Signed-in areas are never cached or indexed.
    ...(appPage
      ? { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }
      : {}),
  };
  if (!["GET", "HEAD"].includes(request.method))
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...headers, Allow: "GET, HEAD" },
    });
  if (frontendFiles.has(path)) {
    if (!bindings.DOCS_ASSETS) {
      const fallback = path.endsWith("/app.js")
        ? [assets.script, "text/javascript; charset=utf-8"]
        : path.endsWith("/app.css")
          ? [assets.css, "text/css; charset=utf-8"]
          : null;
      return new Response(
        request.method === "HEAD"
          ? null
          : fallback?.[0] || "Asset binding unavailable",
        {
          status: fallback ? 200 : 503,
          headers: {
            ...headers,
            "Content-Type": fallback?.[1] || "text/plain; charset=utf-8",
          },
        },
      );
    }
    const response = await bindings.DOCS_ASSETS.fetch(
        new Request(new URL(path, request.url), { method: request.method }),
      ),
      merged = new Headers(response.headers);
    for (const [name, value] of Object.entries(headers))
      merged.set(name, value);
    if (/\/[a-zA-Z0-9_.-]+-[A-Z0-9]{8}\./.test(path))
      merged.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(request.method === "HEAD" ? null : response.body, {
      status: response.status,
      headers: merged,
    });
  }
  const file = staticFiles[path];
  if (file)
    return new Response(request.method === "HEAD" ? null : file[0], {
      headers: { ...headers, "Content-Type": file[1] },
    });
  const guide = assets.pages.find((g) => path === "/docs/guide/" + g.slug),
    page =
      landing ||
      appPage ||
      ["/docs", "/docs/", "/docs/reference"].includes(path) ||
      guide;
  if (page)
    return new Response(request.method === "HEAD" ? null : assets.html, {
      headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
    });
  if (path.startsWith("/docs/guide/"))
    return new Response(request.method === "HEAD" ? null : assets.html, {
      status: 404,
      headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
    });
  return new Response(
    request.method === "HEAD" ? null : "Documentation asset not found",
    {
      status: 404,
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    },
  );
}

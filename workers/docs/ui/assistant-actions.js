import { routeHref } from "./request.js";

// Pip writes action tags on its last line; the page only ever executes
// navigation to known docs pages and highlights of data-pip targets.
const TAG = /\[\[\s*(ENDPOINT|GUIDE|GO|POINT)\s*\|([^\]]*)\]\]/gi;
const PAGES = new Set(["/", "/docs", "/docs/reference"]);

export function splitReply(raw = "") {
  const actions = [...String(raw).matchAll(TAG)].map((m) => ({
    kind: m[1].toUpperCase(),
    args: m[2].split("|").map((x) => x.trim()),
  }));
  const text = String(raw)
    .replace(TAG, "")
    // hide a tag that is still streaming in
    .replace(/\[\[[^\]]*\]?$/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, actions };
}

export function resolveAction(action, catalog, guides) {
  const [first = "", second = ""] = action.args;
  if (action.kind === "ENDPOINT") {
    const [method = "", path = ""] = first.split(/\s+/);
    const route = catalog.routes.find(
      (r) => r.method === method.toUpperCase() && r.path === path,
    );
    return route
      ? {
          type: "nav",
          href: routeHref(route),
          label: route.method + " " + route.path,
        }
      : null;
  }
  if (action.kind === "GUIDE") {
    const guide = guides.find((g) => g.slug === first);
    return guide
      ? { type: "nav", href: "/docs/guide/" + guide.slug, label: guide.title }
      : null;
  }
  if (action.kind === "GO") {
    const guide = guides.find((g) => "/docs/guide/" + g.slug === first);
    return PAGES.has(first) || guide
      ? {
          type: "nav",
          href: first,
          label:
            guide?.title ||
            {
              "/": "Beranda",
              "/docs": "Dokumentasi",
              "/docs/reference": "API Reference",
            }[first],
        }
      : null;
  }
  if (action.kind === "POINT")
    return /^[a-z0-9-]{1,60}$/.test(first)
      ? { type: "point", id: first, label: (second || first).slice(0, 80) }
      : null;
  return null;
}

export function resolveActions(raw, catalog, guides) {
  return splitReply(raw)
    .actions.map((a) => resolveAction(a, catalog, guides))
    .filter(Boolean)
    .slice(0, 3);
}

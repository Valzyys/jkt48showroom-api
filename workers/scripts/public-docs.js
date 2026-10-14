import { readFile } from "node:fs/promises";
const root = new URL("../docs/", import.meta.url);
// Explicit publication boundary. Only consumer API content can be exported.
export function isPublicRoute(route) {
  return (
    ["Publik", "Media"].includes(route.group) &&
    route.auth !== "Session opsional" &&
    !/^\/(?:internal|control|api\/(?:admin|auth|user))(?:\/|$)/.test(route.path)
  );
}
export async function loadPublicDocumentation() {
  const full = JSON.parse(await readFile(new URL("routes.json", root), "utf8"));
  const catalog = { ...full, routes: full.routes.filter(isPublicRoute) };
  const captured = JSON.parse(
    await readFile(new URL("response-samples.json", root), "utf8"),
  );
  const patterns = catalog.routes.map(
    (route) =>
      new RegExp(
        "^" +
          route.path
            .split("/")
            .map((part) =>
              part.startsWith(":")
                ? "[^/]+"
                : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            )
            .join("/") +
          "$",
      ),
  );
  const responses = {
    ...captured,
    responses: Object.fromEntries(
      Object.entries(captured.responses).filter(([path]) =>
        patterns.some((re) => re.test(new URL(path, catalog.baseUrl).pathname)),
      ),
    ),
  };
  const definitions = JSON.parse(
    await readFile(new URL("public/navigation.json", root), "utf8"),
  );
  const pages = await Promise.all(
    definitions.map(async (page) => ({
      ...page,
      content: (
        await readFile(new URL("public/" + page.slug + ".md", root), "utf8")
      ).replace(/^# .+\n/, ""),
    })),
  );
  const lab = await readFile(new URL("pages/markdown.md", root), "utf8");
  pages.push({
    slug: "markdown",
    title: "Markdown lab",
    content: lab.replace(/^# .+\n/, ""),
  });
  const guide =
    "# JKT48Connect — panduan API publik\n\nBase URL: `https://api.jkt48connect.app`.\n\n" +
    pages.map((p) => "## " + p.title + "\n\n" + p.content).join("\n\n");
  // Fail closed if a future guide or captured response introduces an internal URL.
  for (const text of [
    JSON.stringify(catalog),
    JSON.stringify(responses),
    guide,
  ])
    if (
      /\/(?:internal\/|control\/|api\/(?:admin|auth|user)(?:\/|[\s"?]))/i.test(
        text,
      )
    )
      throw Error("Internal route found in public documentation");
  return { catalog, responses, pages, guide };
}

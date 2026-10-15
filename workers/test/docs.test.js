import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { documentation } from "../src/docs/index.js";
import { catalog } from "../src/docs/assets.js";

test("documentation serves public assets without application bindings and keeps method boundaries", async () => {
  for (const path of [
    "/docs",
    "/docs/",
    "/docs/style.css",
    "/docs/app.js",
    "/docs/routes.json",
    "/docs/responses.json",
    "/docs/guide.md",
  ]) {
    const response = await documentation(
      new Request("https://api.test" + path),
    );
    assert.equal(response.status, 200);
    assert.ok((await response.text()).length > 10);
    assert.match(
      response.headers.get("Content-Security-Policy"),
      /script-src 'self'/,
    );
    assert.equal(
      (
        await documentation(
          new Request("https://api.test" + path, { method: "HEAD" }),
        )
      ).body,
      null,
    );
  }
  assert.equal(
    (await documentation(new Request("https://api.test/docs/private.env")))
      .status,
    404,
  );
  assert.equal(
    (
      await documentation(
        new Request("https://api.test/docs", { method: "POST" }),
      )
    ).status,
    405,
  );
  assert.equal(
    await documentation(new Request("https://api.test/api/news")),
    null,
  );
});

test("public catalog documents consumer APIs and excludes operational routes", async () => {
  const declared = new Set(catalog.routes.map((r) => r.method + " " + r.path));
  assert.equal(declared.size, catalog.routes.length);
  for (const path of [
    "/api/news",
    "/api/member",
    "/api/theater",
    "/api/recent",
    "/api/recent/:id",
    "/api/screenshots/:id",
  ])
    assert.ok(declared.has("GET " + path), path);
  for (const route of catalog.routes) {
    assert.ok(["Publik", "Media"].includes(route.group));
    assert.ok(
      !/^\/(?:internal|control|api\/(?:admin|auth|user))(?:\/|$)/.test(
        route.path,
      ),
    );
    if (route.tryEnabled) {
      assert.equal(route.method, "GET");
      assert.equal(route.auth, "Publik");
    }
  }
});

test("public guides, downloadable Markdown, response archives, and search contain no operational documentation", async () => {
  for (const path of [
    "/docs/routes.json",
    "/docs/responses.json",
    "/docs/pages.json",
    "/docs/guide.md",
  ]) {
    const result = await documentation(new Request("https://api.test" + path));
    const body = await result.text();
    assert.doesNotMatch(
      body,
      /\/(?:internal\/|control\/|api\/(?:admin|auth|user)(?:\/|[\s"?]))/i,
      path,
    );
  }
  for (const slug of [
    "admin",
    "control-admin--media",
    "collector-otomatis-screenshot-dan-video-replay",
    "pemantauan-vps-dari-admin",
  ])
    assert.equal(
      (await documentation(new Request("https://api.test/docs/guide/" + slug)))
        .status,
      404,
    );
});

test("landing negotiates HTML without taking over API clients or authenticated routes", async () => {
  const landing = await documentation(
    new Request("https://api.test/", { headers: { Accept: "text/html" } }),
  );
  assert.equal(landing.status, 200);
  assert.match(await landing.text(), /type="module"/);
  assert.equal(landing.headers.get("Vary"), "Accept");
  for (const path of [
    "/",
    "/?format=json",
    "/api/recent",
    "/control/admin",
    "/internal/collector/config",
    "/media/live/data/video-1.mp4",
  ]) {
    assert.equal(
      await documentation(
        new Request("https://api.test" + path, {
          headers: { Accept: path === "/" ? "application/json" : "text/html" },
        }),
      ),
      null,
      path,
    );
  }
  const page = await documentation(
    new Request("https://api.test/docs/guide/mulai-menggunakan"),
  );
  assert.equal(page.status, 200);
  assert.equal(
    (await documentation(new Request("https://api.test/docs/guide/missing")))
      .status,
    404,
  );
  assert.equal(
    (
      await documentation(new Request("https://api.test/docs/pages.json"))
    ).headers.get("Content-Type"),
    "application/json; charset=utf-8",
  );
});

test("only generated frontend assets reach the static binding and retain security headers", async () => {
  const { assets } = await import("../src/docs/assets.js");
  let calls = 0;
  const bindings = {
    DOCS_ASSETS: {
      fetch: async (request) => {
        calls++;
        return new Response("asset", {
          headers: { "Content-Type": "text/javascript" },
        });
      },
    },
  };
  const path = assets.frontendFiles.find((p) =>
    /chunks\/.+-[A-Z0-9]{8}\.js$/.test(p),
  );
  assert.ok(path);
  const result = await documentation(
    new Request("https://api.test" + path),
    bindings,
  );
  assert.equal(await result.text(), "asset");
  assert.match(result.headers.get("Cache-Control"), /immutable/);
  assert.match(
    result.headers.get("Content-Security-Policy"),
    /object-src 'none'/,
  );
  assert.equal(
    (
      await documentation(
        new Request("https://api.test/docs/assets/private.env"),
        bindings,
      )
    ).status,
    404,
  );
  assert.equal(calls, 1);
});

test("request examples preserve authentication, parameters, body types, and safe Try boundaries", async () => {
  const { requestCode, requestUrl, canTry, initialParams } =
    await import("../docs/ui/request.js");
  const route = {
    method: "POST",
    path: "/api/item/:id",
    auth: "API key",
    contentType: "application/json",
    query: { page: "2" },
    body: { title: "true false null", active: true, empty: null },
  };
  const values = initialParams({ ...route, examplePath: "/api/item/demo" });
  assert.equal(values.id, "demo");
  assert.equal(
    requestUrl(route, { id: "a/b", page: "3" }).pathname,
    "/api/item/a%2Fb",
  );
  const python = requestCode(route, values, "python");
  assert.match(python, /"title": "true false null"/);
  assert.match(python, /"active": True/);
  assert.match(python, /"empty": None/);
  assert.match(python, /JKT48CONNECT_API_KEY/);
  assert.equal(canTry({ ...route, tryEnabled: true }), false);
  assert.equal(
    canTry({
      method: "GET",
      path: "/api/news",
      auth: "Publik",
      tryEnabled: true,
    }),
    true,
  );
  for (const path of [
    "/internal/collector/config",
    "/control/api/key",
    "/media/live/x/video-1.mp4",
    "/api/auth/login",
    "/api/showroom/gift",
  ])
    assert.equal(
      canTry({ method: "GET", path, auth: "Publik", tryEnabled: true }),
      false,
      path,
    );
});

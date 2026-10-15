import { build } from "esbuild";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPublicDocumentation } from "./public-docs.js";
const root = fileURLToPath(new URL("..", import.meta.url));
export async function buildDocsUI() {
  const out = path.join(root, "public-docs");
  await rm(out, { recursive: true, force: true });
  await mkdir(path.join(out, "docs", "assets"), { recursive: true });
  await build({
    absWorkingDir: root,
    entryPoints: ["docs/ui/app.jsx"],
    outdir: "public-docs/docs/assets",
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    minify: true,
    jsx: "automatic",
    publicPath: "/docs/assets",
    chunkNames: "chunks/[name]-[hash]",
    assetNames: "files/[name]-[hash]",
    entryNames: "app",
    legalComments: "linked",
    loader: {
      ".woff2": "file",
      ".woff": "file",
      ".ttf": "file",
      ".eot": "file",
      ".svg": "file",
      ".wasm": "file",
    },
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  const { catalog, pages, guide: source } = await loadPublicDocumentation();
  const shell = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#ffffff"><meta name="description" content="Dokumentasi publik JKT48Connect. Panduan API, ${catalog.routes.length} method dan route, autentikasi, live, recent, serta contoh request dan respons."><title>JKT48Connect Developers · Dari oshi. Jadi karyamu.</title><link rel="icon" href="/docs/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/docs/assets/app.css"><script type="module" src="/docs/assets/app.js"></script></head><body><div id="root"><main class="boot" role="status" aria-live="polite"><div class="boot-grid" aria-hidden="true"></div><div class="boot-particles" aria-hidden="true"><i style="--x:0%;--t:6s;--w:0s"></i><i style="--x:37%;--t:13s;--w:3s"></i><i style="--x:74%;--t:11s;--w:1s"></i><i style="--x:11%;--t:9s;--w:4s"></i><i style="--x:48%;--t:7s;--w:2s"></i><i style="--x:85%;--t:14s;--w:0s"></i><i style="--x:22%;--t:12s;--w:3s"></i><i style="--x:59%;--t:10s;--w:1s"></i><i style="--x:96%;--t:8s;--w:4s"></i><i style="--x:33%;--t:6s;--w:2s"></i><i style="--x:70%;--t:13s;--w:0s"></i><i style="--x:7%;--t:11s;--w:3s"></i><i style="--x:44%;--t:9s;--w:1s"></i><i style="--x:81%;--t:7s;--w:4s"></i><i style="--x:18%;--t:14s;--w:2s"></i><i style="--x:55%;--t:12s;--w:0s"></i><i style="--x:92%;--t:10s;--w:3s"></i><i style="--x:29%;--t:8s;--w:1s"></i></div><div class="boot-card"><div class="boot-stage" aria-hidden="true"><div class="boot-orbit"><span></span><span></span><span></span></div><div class="boot-mark"><i class="" style="--d:0.00s"></i><i class="" style="--d:0.06s"></i><i class="on" style="--d:0.12s"></i><i class="on" style="--d:0.18s"></i><i class="on" style="--d:0.24s"></i><i class="on" style="--d:0.30s"></i><i class="on" style="--d:0.36s"></i><i class="" style="--d:0.06s"></i><i class="" style="--d:0.12s"></i><i class="" style="--d:0.18s"></i><i class="" style="--d:0.24s"></i><i class="on" style="--d:0.30s"></i><i class="on" style="--d:0.36s"></i><i class="" style="--d:0.42s"></i><i class="" style="--d:0.12s"></i><i class="" style="--d:0.18s"></i><i class="" style="--d:0.24s"></i><i class="" style="--d:0.30s"></i><i class="on" style="--d:0.36s"></i><i class="on" style="--d:0.42s"></i><i class="" style="--d:0.48s"></i><i class="" style="--d:0.18s"></i><i class="" style="--d:0.24s"></i><i class="" style="--d:0.30s"></i><i class="" style="--d:0.36s"></i><i class="on" style="--d:0.42s"></i><i class="on" style="--d:0.48s"></i><i class="" style="--d:0.54s"></i><i class="on" style="--d:0.24s"></i><i class="on" style="--d:0.30s"></i><i class="" style="--d:0.36s"></i><i class="" style="--d:0.42s"></i><i class="on" style="--d:0.48s"></i><i class="on" style="--d:0.54s"></i><i class="" style="--d:0.60s"></i><i class="on" style="--d:0.30s"></i><i class="on" style="--d:0.36s"></i><i class="" style="--d:0.42s"></i><i class="" style="--d:0.48s"></i><i class="on" style="--d:0.54s"></i><i class="on" style="--d:0.60s"></i><i class="" style="--d:0.66s"></i><i class="" style="--d:0.36s"></i><i class="on" style="--d:0.42s"></i><i class="on" style="--d:0.48s"></i><i class="on" style="--d:0.54s"></i><i class="on" style="--d:0.60s"></i><i class="" style="--d:0.66s"></i><i class="" style="--d:0.72s"></i></div><div class="boot-percent"></div><div class="boot-scan"></div></div><div class="boot-body"><p class="boot-eyebrow"><span class="boot-dot"></span>JKT48CONNECT · DEVELOPERS</p><h1 class="boot-title">Dari oshi.<br><em>Jadi karyamu.</em></h1><div class="boot-bar" aria-hidden="true"><i></i></div><ul class="boot-steps" aria-hidden="true"><li style="--i:0"><span class="boot-check"></span>Memuat katalog 53 route</li><li style="--i:1"><span class="boot-check"></span>Menyiapkan dashboard developer</li><li style="--i:2"><span class="boot-check"></span>Menghubungkan live &amp; recent</li><li style="--i:3"><span class="boot-check"></span>Membangunkan Pip</li></ul><ol class="boot-term" aria-hidden="true"><li style="--i:0"><b>GET</b> /api/now_live <em>200</em> <small>38ms</small></li><li style="--i:1"><b>GET</b> /api/news?page=1 <em>200</em> <small>52ms</small></li><li style="--i:2"><b>GET</b> /api/theater <em>200</em> <small>61ms</small></li><li style="--i:3"><b>GET</b> /api/recent <em>200</em> <small>47ms</small></li><li style="--i:4"><b>GET</b> /api/member <em>200</em> <small>29ms</small></li></ol><span class="sr-only">Menyiapkan dokumentasi…</span><a class="boot-link" href="/docs/guide.md">Baca panduan Markdown lengkap</a></div></div><div class="boot-marquee" aria-hidden="true"><div><span>GET /api/now_live</span><span>GET /api/news</span><span>GET /api/member</span><span>GET /api/theater</span><span>GET /api/recent</span><span>GET /api/birthday</span><span>GET /api/next_schedule</span><span>GET /api/idn_lives</span><span>GET /api/recent/:id/gifts</span><span>GET /api/screenshots/:id</span><span>GET /replay/:id</span><span>GET /api/48/member</span><span>GET /api/now_live</span><span>GET /api/news</span><span>GET /api/member</span><span>GET /api/theater</span><span>GET /api/recent</span><span>GET /api/birthday</span><span>GET /api/next_schedule</span><span>GET /api/idn_lives</span><span>GET /api/recent/:id/gifts</span><span>GET /api/screenshots/:id</span><span>GET /replay/:id</span><span>GET /api/48/member</span></div></div><noscript><p>Aktifkan JavaScript untuk navigasi interaktif, pencarian, serta playground. Panduan Markdown dan katalog JSON tersedia tanpa JavaScript.</p><a href="/docs/routes.json">Katalog route JSON</a></noscript></main></div></body></html>`;
  await writeFile(path.join(out, "index.html"), shell);
  await writeFile(path.join(out, "docs", "pages.json"), JSON.stringify(pages));
  const favicon =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#ffffff"/><path fill="#0c0c0e" d="M4 4h10v5H9v5H4zm14 0h10v10h-5V9h-5zM4 18h5v5h5v5H4zm19 0h5v10H18v-5h5z"/><rect x="13" y="13" width="6" height="6" fill="#e4002b"/></svg>';
  await writeFile(path.join(out, "docs", "favicon.svg"), favicon);
  for (const name of ["geist", "geist-mono", "doto"])
    await copyFile(
      path.join(root, "node_modules", "@fontsource-variable", name, "LICENSE"),
      path.join(out, "docs", "assets", name + "-LICENSE.txt"),
    );
  const files = [];
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(file);
      else files.push("/" + path.relative(out, file).split(path.sep).join("/"));
    }
  }
  await walk(path.join(out, "docs", "assets"));
  return {
    html: shell,
    css: await readFile(path.join(out, "docs", "assets", "app.css"), "utf8"),
    script: await readFile(path.join(out, "docs", "assets", "app.js"), "utf8"),
    pages,
    frontendFiles: files,
    guide: source,
    favicon,
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await buildDocsUI();
  console.log(
    `React documentation built: ${result.pages.length} guides, ${result.frontendFiles.length} assets.`,
  );
}

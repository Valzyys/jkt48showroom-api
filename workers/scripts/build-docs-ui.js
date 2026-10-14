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
  const shell = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#ffffff"><meta name="description" content="Dokumentasi publik JKT48Connect. Panduan API, ${catalog.routes.length} method dan route, autentikasi, live, recent, serta contoh request dan respons."><title>JKT48Connect Developers · Dari oshi. Jadi karyamu.</title><link rel="icon" href="/docs/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/docs/assets/app.css"><script type="module" src="/docs/assets/app.js"></script></head><body><div id="root"><main class="boot-error"><h1>JKT48Connect Developers</h1><p>Dari oshi. Jadi karyamu. Menyiapkan dokumentasi…</p><a href="/docs/guide.md">Baca panduan Markdown lengkap</a><noscript><p>Aktifkan JavaScript untuk navigasi interaktif, pencarian, serta playground. Panduan Markdown dan katalog JSON tersedia tanpa JavaScript.</p><a href="/docs/routes.json">Katalog route JSON</a></noscript></main></div></body></html>`;
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

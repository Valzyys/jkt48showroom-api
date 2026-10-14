import { assets, catalog } from "./assets.js";

// What Pip reads before answering. The public guides are split per section
// and every public endpoint becomes a card with its parameters, response
// shape, and a trimmed production sample. A small keyword ranker picks the
// sections that fit the question, plus whatever page the user has open.

// Headings rendered by the React views (overview and endpoint pages).
const UI_HEADINGS = [
  "Request pertama dalam satu baris.",
  "Pilih jalurmu",
  "Sebelum memulai",
  "Semua panduan",
  "Parameter",
  "Request body",
  "Contoh request",
  "Respons",
];

// Indonesian words people type, mapped to the words the docs use.
const SYNONYMS = {
  berita: ["news"],
  kabar: ["news"],
  jadwal: ["schedule", "theater", "event"],
  teater: ["theater"],
  pertunjukan: ["theater", "show"],
  acara: ["event"],
  ultah: ["birthday", "ulang", "tahun"],
  lahir: ["birthday"],
  anggota: ["member"],
  oshi: ["member"],
  siaran: ["live", "stream"],
  nonton: ["live", "watch", "replay"],
  tonton: ["watch", "replay"],
  rekaman: ["replay", "recording", "rekaman"],
  putar: ["replay", "player"],
  memutar: ["replay", "player"],
  video: ["replay", "recording", "youtube"],
  hadiah: ["gift"],
  gift: ["gifts", "gift"],
  peringkat: ["leaderboard", "ranking"],
  ranking: ["leaderboard", "competition"],
  gambar: ["image", "media", "screenshot"],
  foto: ["image", "media", "screenshot", "photobook"],
  tangkapan: ["screenshot"],
  kunci: ["key", "api_key"],
  token: ["key", "api_key", "signature"],
  galat: ["error", "status"],
  gagal: ["error", "status"],
  waktu: ["timestamp", "time"],
  durasi: ["duration"],
  penonton: ["viewers"],
  riwayat: ["recent", "history"],
  terakhir: ["recent", "latest"],
  terbaru: ["latest", "recent", "news"],
  sekarang: ["now_live", "live"],
  berlangsung: ["now_live", "live"],
  tayang: ["now_live", "live"],
  401: ["status", "error", "key"],
  403: ["status", "error", "key"],
  404: ["status", "error"],
  429: ["status", "error"],
  berikutnya: ["next", "next_schedule", "next_live"],
  setlist: ["setlist"],
  lagu: ["setlist"],
};
const STOP = new Set(
  "yang untuk dan di ke dari apa apakah bagaimana gimana cara ini itu dengan saya aku kamu bisa ada buat buatkan tolong mana dong ya kak pip sih nya juga atau agar kenapa dapat sedang jelaskan tentang lagi saja halaman bagian buka kubuka dibuka lihat kulihat maksud supaya pakai pakai pake mau ingin jadi sudah belum the a an to of in on for is are how what with and or api endpoint data contoh kode code".split(
    " ",
  ),
);

const THIS_PAGE =
  /\b(halaman|bagian|page)\s+(ini|yang\s+(sedang\s+)?(ku|di)?(buka|lihat))\b|\b(sedang|lagi)\s+(ku|di)?(buka|lihat)\b|\bthis\s+page\b/i;

// Synonyms widen the question only; the docs are indexed as written.
export function tokens(text, expand = true) {
  const out = [];
  for (let word of String(text || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)) {
    if (word.length > 4 && word.endsWith("nya")) word = word.slice(0, -3);
    if (word.length < 2 || STOP.has(word)) continue;
    out.push(word, ...((expand && SYNONYMS[word]) || []));
  }
  return out;
}

const clip = (value, max) => {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
};

// {news: {date: string, …}[], page: number} — field names without the bulk.
export function shape(value, depth = 0) {
  if (Array.isArray(value))
    return value.length ? shape(value[0], depth) + "[]" : "[]";
  if (value && typeof value === "object") {
    if (depth >= 3) return "{…}";
    const keys = Object.keys(value);
    return (
      "{" +
      keys
        .slice(0, 24)
        .map((k) => k + ": " + shape(value[k], depth + 1))
        .join(", ") +
      (keys.length > 24 ? ", …" : "") +
      "}"
    );
  }
  return value === null ? "null" : typeof value;
}

function trim(value, depth = 0) {
  if (Array.isArray(value))
    return value.length ? [trim(value[0], depth + 1)] : [];
  if (value && typeof value === "object") {
    if (depth > 4) return {};
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 24)
        .map(([k, v]) => [k, trim(v, depth + 1)]),
    );
  }
  return typeof value === "string" ? clip(value, 120) : value;
}

const anchor = (heading) =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");

let index;
export function docsIndex() {
  if (index) return index;
  const chunks = [];
  for (const page of assets.pages) {
    const parts = page.content.split(/^## /m);
    parts.forEach((part, i) => {
      const lines = part.trim().split("\n"),
        heading = i ? lines[0].trim() : "";
      const text = (i ? lines.slice(1) : lines.filter((l) => !/^# /.test(l)))
        .join("\n")
        .trim();
      if (!text) return;
      chunks.push({
        id: `guide:${page.slug}#${heading ? anchor(heading) : "intro"}`,
        kind: "guide",
        slug: page.slug,
        title: heading ? `${page.title} › ${heading}` : page.title,
        heading,
        href: "/docs/guide/" + page.slug,
        text,
      });
    });
  }
  for (const r of catalog.routes) {
    if (r.auth === "Internal" || /admin/.test(r.path)) continue;
    const key = r.method + " " + r.path,
      query = Object.entries(r.query || {});
    const lines = [
      `${key}`,
      `Akses: ${r.auth} · Grup: ${r.group}`,
      `Keterangan: ${r.description.replace(/`/g, "")}`,
      query.length
        ? "Query: " + query.map(([k, v]) => `${k} (contoh ${v})`).join(", ")
        : "Query: tidak ada",
      `Contoh URL: ${catalog.baseUrl}${r.examplePath}${
        query.length
          ? "?" +
            query.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")
          : ""
      }`,
    ];
    if (r.response?.body !== undefined) {
      lines.push(
        `Status contoh: ${r.response.status} (${r.responseLabel || "contoh"})`,
        `Bentuk respons: ${shape(r.response.body)}`,
        `Contoh respons (dipangkas): ${clip(JSON.stringify(trim(r.response.body)), 1400)}`,
      );
    } else lines.push(`Respons: ${r.responseLabel || "belum ada contoh"}`);
    chunks.push({
      id: "endpoint:" + key,
      kind: "endpoint",
      key,
      title: key,
      href: "/docs/reference?route=" + encodeURIComponent(key),
      text: lines.join("\n"),
    });
  }
  // Term statistics for ranking: titles count three times.
  const df = new Map();
  for (const c of chunks) {
    c.tf = new Map();
    const add = (list, weight) =>
      list.forEach((t) => c.tf.set(t, (c.tf.get(t) || 0) + weight));
    add(tokens(c.title.replace(/[/:_]/g, " "), false), 3);
    // Sample payloads are long and full of incidental words; rank on the rest.
    add(tokens(c.text.replace(/^Contoh respons.*$/m, ""), false), 1);
    c.size = [...c.tf.values()].reduce((a, b) => a + b, 0);
    for (const t of c.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  }
  const headings = new Set(UI_HEADINGS.map((h) => h.toLowerCase()));
  chunks.forEach((c) => c.heading && headings.add(c.heading.toLowerCase()));
  const avg = chunks.reduce((a, c) => a + c.size, 0) / chunks.length;
  index = { chunks, df, avg, headings };
  return index;
}

// Only headings that really exist on the docs may reach the prompt.
export function knownHeading(text) {
  const value = typeof text === "string" ? text.trim().slice(0, 120) : "";
  return value && docsIndex().headings.has(value.toLowerCase()) ? value : "";
}

function pageChunks(path, chunks) {
  let url;
  try {
    url = new URL(path || "/", "https://docs.local");
  } catch {
    return [];
  }
  const guide = url.pathname.match(/^\/docs\/guide\/([a-z0-9-]+)$/);
  if (guide) return chunks.filter((c) => c.slug === guide[1]);
  const route = url.searchParams.get("route");
  if (url.pathname === "/docs/reference" && route)
    return chunks.filter((c) => c.key === route);
  if (url.pathname === "/docs" || url.pathname === "/docs/")
    return chunks.filter((c) => c.slug === "mulai-menggunakan");
  // The landing page and the endpoint list introduce the API as a whole.
  if (url.pathname === "/" || url.pathname === "/docs/reference")
    return chunks.filter((c) => c.slug === "tentang-panduan");
  return [];
}

// Rank sections for a question. `history` is the user's earlier questions,
// newest last; they count half so follow-ups keep their topic.
export function retrieve(question, { history = [], path = "/" } = {}) {
  const { chunks, df, avg } = docsIndex(),
    weights = new Map();
  const add = (text, w) =>
    tokens(text).forEach((t) => weights.set(t, (weights.get(t) || 0) + w));
  add(question, 1);
  history.slice(-2).forEach((q) => add(q, 0.5));
  const literal = [
    ...String(question).matchAll(/\/(?:api|media|replay)\/[\w/:.-]*/g),
  ].map((m) => m[0].replace(/\/$/, ""));
  const scored = chunks.map((c) => {
    let score = 0;
    for (const [t, w] of weights) {
      const tf = c.tf.get(t);
      if (!tf) continue;
      const idf = Math.log(
        1 + (chunks.length - df.get(t) + 0.5) / (df.get(t) + 0.5),
      );
      score +=
        w * idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (c.size / avg))));
    }
    if (c.kind === "endpoint" && literal.some((p) => c.key.endsWith(" " + p)))
      score += 20;
    return { c, score };
  });
  // Weak matches next to a strong one are noise, so keep within 40% of the top.
  const best = (kind, n) => {
    const list = scored
      // The Markdown lab documents the docs themselves, not the API.
      .filter(
        (s) =>
          s.c.kind === kind &&
          s.score > 1.2 &&
          (s.c.slug !== "markdown" || weights.has("markdown")),
      )
      .sort((a, b) => b.score - a.score);
    const top = list[0]?.score || 0;
    return list
      .filter((s) => s.score >= top * 0.4)
      .slice(0, n)
      .map((s) => s.c);
  };
  const open = pageChunks(path, chunks);
  // "Jelaskan halaman ini": the open page is the whole answer.
  if (open.length && THIS_PAGE.test(question))
    return { read: open, current: open };
  // Otherwise the open page counts only where it fits the question, or when
  // nothing else does (a vague follow-up such as "contohnya?").
  const fit = new Map(scored.map((s) => [s.c, s.score])),
    top = Math.max(...fit.values());
  let current = open.filter((c) => fit.get(c) > 1.2 && fit.get(c) >= top * 0.4);
  const picked = [...current];
  for (const c of [...best("endpoint", 4), ...best("guide", 5)])
    if (!picked.includes(c)) picked.push(c);
  if (!picked.length) picked.push(...(current = open));
  // Keep the prompt bounded: the open page first, then the best matches.
  let budget = 14000;
  const read = picked.filter(
    (c) => (budget -= c.text.length) > 0 || current.includes(c),
  );
  return { read, current };
}

// One chip per page the reader can open, in reading order.
export function sourcesOf(read) {
  const seen = new Map();
  for (const c of read) {
    const key = c.href;
    if (seen.has(key)) continue;
    const page = assets.pages.find((p) => p.slug === c.slug);
    seen.set(key, {
      kind: c.kind,
      title: c.kind === "guide" ? page?.title || c.title : c.title,
      section: c.kind === "guide" ? c.heading || "" : "",
      href: c.href,
    });
  }
  return [...seen.values()].slice(0, 6);
}

export function tableOfContents() {
  return assets.pages
    .map((p) => {
      const heads = [...p.content.matchAll(/^## (.+)$/gm)].map((m) =>
        m[1].trim(),
      );
      return `- ${p.title} (slug ${p.slug}): ${heads.join(" · ") || "-"}`;
    })
    .join("\n");
}

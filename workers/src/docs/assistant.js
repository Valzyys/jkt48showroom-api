import { assets, catalog } from "./assets.js";

// Pip, the docs assistant. Grounded on the public catalog and guides only, it
// answers, writes integration code, and asks the page to navigate or point at
// UI elements through small action tags the browser executes.
const CONSOLE_URL = "https://console.mistral.ai/api-ui/bora/v1/conversations";
const API_URL = "https://api.mistral.ai/v1/chat/completions";
const MAX_BODY = 32 * 1024;
const MAX_MESSAGES = 12;
const MAX_CHARS = 4000;

// UI targets the page marks with data-pip. Kept in sync with the React views.
export const UI_TARGETS = {
  "nav-search": "Tombol Cari (⌘K) di header, semua halaman",
  "nav-home": "Menu Beranda di header",
  "nav-docs": "Menu Docs di header",
  "nav-reference": "Menu Reference di header",
  "nav-markdown": "Menu Markdown lab di header",
  "nav-cta": "Tombol Mulai di header",
  "motion-toggle": "Saklar animasi di header",
  "hero-start": "Tombol Mulai membangun (beranda)",
  "hero-terminal": "Perintah curl pertama yang bisa disalin (beranda)",
  "landing-features": "Kartu kategori data (beranda)",
  "landing-request": "Contoh kode JS/Python/cURL dengan tab bahasa (beranda)",
  "landing-map": "Peta endpoint per kategori (beranda)",
  "sidebar-filter": "Kolom filter panduan di sidebar docs",
  "sidebar-reference": "Link API Reference di sidebar docs",
  "overview-quickstart": "Panel quick start (halaman /docs)",
  "overview-baseurl": "Base URL dan format waktu (halaman /docs)",
  "reference-search": "Kolom cari endpoint (halaman /docs/reference)",
  "reference-filters": "Filter method dan grup (halaman /docs/reference)",
  "reference-list": "Daftar semua endpoint (halaman /docs/reference)",
  "endpoint-params": "Parameter yang bisa diedit (halaman detail endpoint)",
  "endpoint-url": "Preview URL request (halaman detail endpoint)",
  "endpoint-request":
    "Contoh request dengan tab cURL/JavaScript/Python (halaman detail endpoint)",
  "endpoint-try": "Tombol Coba GET (halaman detail endpoint publik)",
  "endpoint-response": "Contoh atau hasil respons (halaman detail endpoint)",
  "guide-content": "Isi panduan yang sedang dibuka",
  "markdown-editor": "Tombol Coba Markdown sendiri (Markdown lab)",
  toc: "Daftar isi halaman di sisi kanan docs",
};

const clip = (value, max) => {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
};

let knowledge;
function buildKnowledge() {
  if (knowledge) return knowledge;
  const routes = catalog.routes
    .map(
      (r) =>
        `- ${r.method} ${r.path} | ${r.auth} | ${r.group} | ${clip(r.description.replace(/`/g, ""), 180)}` +
        (r.query && Object.keys(r.query).length
          ? ` | query: ${Object.keys(r.query).join(", ")}`
          : ""),
    )
    .join("\n");
  const guides = assets.pages
    .filter((p) => p.slug !== "markdown")
    .map((p) => `### ${p.title} (slug: ${p.slug})\n${p.content.trim()}`)
    .join("\n\n");
  knowledge = { routes, guides };
  return knowledge;
}

export function buildInstructions(page = {}) {
  const { routes, guides } = buildKnowledge();
  const targets = Object.entries(UI_TARGETS)
    .map(([id, label]) => `- ${id}: ${label}`)
    .join("\n");
  const guideSlugs = assets.pages
    .map((p) => `${p.slug} (${p.title})`)
    .join(", ");
  return `Kamu adalah Pip, asisten interaktif di dokumentasi developer JKT48Connect (${catalog.baseUrl}).
Tugasmu: menjawab pertanyaan tentang API publik JKT48Connect, mengarahkan pengguna ke bagian UI yang tepat di halaman docs ini, dan menuliskan kode implementasi.

ATURAN
- Bahasa Indonesia yang santai, jelas, dan ringkas. Jangan bertele-tele.
- Hanya gunakan endpoint dari KATALOG di bawah. Jangan mengarang endpoint, parameter, field respons, harga, atau jadwal. Jika tidak ada, katakan terus terang.
- JKT48Connect adalah proyek fans independen, bukan manajemen resmi JKT48.
- Kode: gunakan blok markdown bertag bahasa (\`\`\`javascript, \`\`\`python, \`\`\`bash). Base URL ${catalog.baseUrl}. Tangani error HTTP. Endpoint ber-API key hanya dipanggil dari server dan key dibaca dari environment variable, jangan pernah ditulis langsung di kode frontend.
- Jangan pernah meminta atau menampilkan password, cookie, token, atau API key asli.
- Format: markdown biasa (judul pendek, list, tabel kecil boleh).

AKSI UI
Kamu bisa menggerakkan halaman dengan menulis tag di BARIS TERAKHIR jawaban (pengguna tidak melihat tag). Maksimal 3 tag, gunakan hanya jika membantu:
[[ENDPOINT|METHOD /path]]  buka halaman detail endpoint, contoh [[ENDPOINT|GET /api/news]]
[[GUIDE|slug]]             buka panduan. Slug tersedia: ${guideSlugs}
[[GO|/path]]               buka halaman: / , /docs , /docs/reference
[[POINT|target|label]]     sorot elemen UI dengan label singkat, contoh [[POINT|endpoint-try|Klik untuk mencoba]]
Urutan: tag navigasi dulu, lalu POINT untuk elemen di halaman tujuan. Target POINT yang valid:
${targets}
- guide-<slug>: link panduan itu di sidebar docs, contoh guide-memutar-replay
Jika pengguna bertanya "di mana" atau "bagaimana cara" sesuatu di website ini, arahkan dengan tag. Sebutkan juga di teks apa yang kamu tunjukkan.

HALAMAN PENGGUNA SAAT INI
Path: ${clip(page.path, 200) || "/"}
Judul: ${clip(page.title, 160) || "-"}
Target yang terlihat sekarang: ${(page.targets || []).join(", ") || "-"}

KATALOG ENDPOINT (method path | akses | grup | ringkasan)
${routes}

PANDUAN
${guides}`;
}

export function sanitizeMessages(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim(),
    )
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
}

export function sanitizePage(page) {
  const valid = new Set(Object.keys(UI_TARGETS)),
    guides = new Set(assets.pages.map((p) => "guide-" + p.slug));
  return {
    path: typeof page?.path === "string" ? page.path.slice(0, 200) : "/",
    title: typeof page?.title === "string" ? page.title.slice(0, 160) : "",
    targets: Array.isArray(page?.targets)
      ? [
          ...new Set(page.targets.filter((t) => valid.has(t) || guides.has(t))),
        ].slice(0, 40)
      : [],
  };
}

// Per-isolate sliding window. A first line of defence; pair it with a
// Cloudflare rate limiting rule on /docs/assistant for a hard global limit.
const buckets = new Map();
export function allowRequest(
  key,
  now = Date.now(),
  limit = 20,
  windowMs = 600000,
) {
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) buckets.delete(buckets.keys().next().value);
  return true;
}
export function resetRateLimit() {
  buckets.clear();
}

function upstreamRequest(bindings, instructions, messages) {
  const model = bindings.MISTRAL_MODEL || "mistral-medium-latest";
  if (bindings.MISTRAL_API_KEY)
    return {
      kind: "api",
      url: API_URL,
      init: {
        method: "POST",
        headers: {
          accept: "text/event-stream",
          "content-type": "application/json",
          authorization: "Bearer " + bindings.MISTRAL_API_KEY,
        },
        body: JSON.stringify({
          model,
          stream: true,
          temperature: 0.4,
          max_tokens: 2048,
          messages: [{ role: "system", content: instructions }, ...messages],
        }),
      },
    };
  return {
    kind: "console",
    url: CONSOLE_URL,
    init: {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        "content-type": "application/json",
        origin: "https://console.mistral.ai",
        referer: "https://console.mistral.ai/build/playground",
        "internal-source": "playground",
        "x-metadata": JSON.stringify({ call_type: "agent_playground" }),
        cookie: bindings.MISTRAL_COOKIE,
      },
      body: JSON.stringify({
        model,
        stream: true,
        instructions,
        name: clip(messages.at(-1)?.content, 100) || "docs",
        completion_args: { temperature: 0.4, max_tokens: 2048, top_p: 1 },
        tools: [],
        inputs: messages.map((m) => ({
          object: "entry",
          type: "message.input",
          role: m.role,
          content: m.content,
          prefix: false,
        })),
      }),
    },
  };
}

// Extract the text delta from one upstream SSE event, for either upstream.
export function deltaFrom(kind, data) {
  if (kind === "api") {
    const piece = data?.choices?.[0]?.delta?.content;
    return typeof piece === "string" ? piece : "";
  }
  if (data?.type === "conversation.response.error")
    throw Object.assign(new Error(data.message || "upstream error"), {
      upstream: true,
    });
  if (data?.type !== "message.output.delta") return "";
  const c = data.content;
  return typeof c === "string" ? c : typeof c?.text === "string" ? c.text : "";
}

const encoder = new TextEncoder();
const event = (value) =>
  encoder.encode("data: " + JSON.stringify(value) + "\n\n");

function relay(kind, upstream, timeoutMs) {
  return new ReadableStream({
    async start(controller) {
      const reader = upstream.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "",
        sent = 0,
        timer;
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => reader.cancel().catch(() => {}), timeoutMs);
      };
      const handle = (raw) => {
        const data = raw
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        if (!data || data === "[DONE]") return;
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          return;
        }
        const piece = deltaFrom(kind, parsed);
        if (piece) {
          sent += piece.length;
          controller.enqueue(event({ t: piece }));
        }
      };
      try {
        arm();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          arm();
          buffer += decoder.decode(value, { stream: true });
          let m;
          while ((m = buffer.match(/\r?\n\r?\n/))) {
            handle(buffer.slice(0, m.index));
            buffer = buffer.slice(m.index + m[0].length);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) handle(buffer);
        controller.enqueue(
          event(
            sent
              ? { done: true }
              : { error: "Pip belum mendapat jawaban. Coba lagi." },
          ),
        );
      } catch {
        controller.enqueue(
          event({ error: "Koneksi ke model terputus. Coba kirim ulang." }),
        );
      } finally {
        clearTimeout(timer);
        controller.close();
      }
    },
  });
}

export async function assistant(request, bindings = {}) {
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  const json = (status, message, extra = {}) =>
    Response.json(
      { status, message },
      { status, headers: { ...headers, ...extra } },
    );
  if (request.method !== "POST")
    return json(405, "Method not allowed", { Allow: "POST" });
  const url = new URL(request.url),
    origin = request.headers.get("Origin");
  // Browser calls must come from this docs origin; the endpoint is not a proxy.
  if (origin && origin !== url.origin)
    return json(403, "Origin tidak diizinkan");
  if (!/application\/json/.test(request.headers.get("Content-Type") || ""))
    return json(415, "Gunakan application/json");
  if (
    String(bindings.ASSISTANT_ENABLED || "true") === "false" ||
    (!bindings.MISTRAL_COOKIE && !bindings.MISTRAL_API_KEY)
  )
    return json(503, "Asisten Pip belum dikonfigurasi di server.");
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "anonymous";
  if (!allowRequest(ip))
    return json(429, "Terlalu banyak pertanyaan. Tunggu beberapa menit.", {
      "Retry-After": "120",
    });
  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json(413, "Pesan terlalu panjang");
    body = JSON.parse(text);
  } catch {
    return json(400, "Body tidak valid");
  }
  const messages = sanitizeMessages(body?.messages);
  if (!messages.length || messages.at(-1).role !== "user")
    return json(400, "Pertanyaan kosong");
  const page = sanitizePage(body?.page);
  const {
    kind,
    url: target,
    init,
  } = upstreamRequest(bindings, buildInstructions(page), messages);
  const timeoutMs = Number(bindings.ASSISTANT_TIMEOUT_MS || 60000);
  let upstream;
  try {
    upstream = await fetch(target, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return json(502, "Model AI tidak dapat dihubungi.");
  }
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel().catch(() => {});
    return json(
      502,
      upstream.status === 401 || upstream.status === 403
        ? "Sesi model AI kedaluwarsa. Perbarui MISTRAL_COOKIE."
        : "Model AI sedang sibuk. Coba lagi.",
    );
  }
  return new Response(relay(kind, upstream, timeoutMs), {
    headers: {
      ...headers,
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}

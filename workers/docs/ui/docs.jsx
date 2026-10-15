import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useMotionEnabled } from "./motion.js";
import { AsciiScene } from "./ascii-scene.jsx";
import { AsciiFriend } from "./personality.jsx";
import { PixelIcon, LangLogo, guideIcon } from "./icons.jsx";
import {
  gsap,
  BASE,
  GitHub,
  Icon,
  Link,
  Copy,
  CodeBlock,
  LanguageTabs,
  useLiquid,
} from "./shared.jsx";
import {
  routeKey,
  routeHref,
  initialParams,
  requestUrl,
  requestCode,
  canTry,
  shortResponse,
} from "./request.js";
const MarkdownContent = lazy(() => import("./markdown.jsx"));
const groups = ["Publik", "Media"];

export function Sidebar({ catalog, guides, current }) {
  const [filter, setFilter] = useState(""),
    list = useRef(),
    marker = useLiquid(list, "a.selected", [current, filter], "y");
  const visible = guides.filter(
    (g) =>
      g.slug !== "markdown" &&
      g.title.toLowerCase().includes(filter.toLowerCase()),
  );
  const all = guides.filter((g) => g.slug !== "markdown");
  const item = (href, label, icon, active, extra, pip) => (
    <Link
      href={href}
      data-pip={pip}
      className={active ? "selected" : ""}
      aria-current={active ? "page" : undefined}
    >
      <span className="side-icon">
        <PixelIcon name={icon} size={13} />
      </span>
      <span className="side-text">{label}</span>
      {extra}
    </Link>
  );
  return (
    <div className="sidebar-inner">
      <label className="sidebar-filter" data-pip="sidebar-filter">
        <Icon name="search" size={14} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter panduan"
          aria-label="Filter navigasi panduan"
        />
      </label>
      <div className="side-list" ref={list}>
        <span className="side-marker" ref={marker} aria-hidden="true" />
        <span className="side-label">MULAI</span>
        <nav aria-label="Dokumentasi utama" className="side-nav">
          {item(
            "/docs",
            "Overview",
            "home",
            current === "/docs" || current === "/docs/",
          )}
          {item(
            "/docs/reference",
            "API Reference",
            "code",
            current.startsWith("/docs/reference"),
            <small className="count">{catalog.routes.length}</small>,
            "sidebar-reference",
          )}
          {item(
            "/docs/guide/markdown",
            "Markdown lab",
            "markdown",
            current.endsWith("/markdown"),
          )}
        </nav>
        <span className="side-label">PANDUAN & INTEGRASI</span>
        <nav aria-label="Panduan dokumentasi" className="side-nav">
          {visible.map((g) =>
            React.cloneElement(
              item(
                "/docs/guide/" + g.slug,
                g.title,
                guideIcon(g.slug),
                current === "/docs/guide/" + g.slug,
                <small className="num">
                  {String(all.indexOf(g) + 1).padStart(2, "0")}
                </small>,
                "guide-" + g.slug,
              ),
              { key: g.slug },
            ),
          )}
          {!visible.length && <p className="side-empty">Tidak ada panduan.</p>}
        </nav>
      </div>
      <div className="sidebar-foot">
        <span>
          <i className="live-dot" /> API online
        </span>
        <small>v{catalog.version}</small>
      </div>
    </div>
  );
}

function PageHead({ crumbs, title, lead, icon, children }) {
  return (
    <header className="page-head">
      <div className="crumbs">
        {icon && (
          <span className="crumb-icon">
            <PixelIcon name={icon} size={13} />
          </span>
        )}
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            <span>{c}</span>
          </React.Fragment>
        ))}
      </div>
      <h1 data-split>{title}</h1>
      {lead && <p className="lead">{lead}</p>}
      {children}
    </header>
  );
}

export function Overview({ catalog, guides }) {
  const list = guides.filter((g) => g.slug !== "markdown");
  const [lang, setLang] = useState("curl");
  const route = catalog.routes.find(
    (r) => r.method === "GET" && r.path === "/api/news",
  ) || { method: "GET", path: "/api/news", auth: "Publik", query: {} };
  const code = requestCode(route, initialParams(route), lang);
  return (
    <>
      <div className="overview-hero">
        <PageHead
          icon="home"
          crumbs={["docs", "overview"]}
          title={
            <>
              Buka catatannya. <span className="soft">Bangun idemu.</span>
            </>
          }
          lead="Kenali API, temukan endpoint, lalu hubungkan ke aplikasimu. Semua panduan dan referensi ada di sini."
        />
        <div className="overview-art">
          <AsciiScene
            shape="torus"
            size={8}
            speed={0.5}
            pitch={0.9}
            className="overview-ascii"
          />
        </div>
      </div>
      <div className="quick-panel" data-pip="overview-quickstart">
        <div className="quick-copy">
          <span className="tag-soft">
            <PixelIcon name="play" size={11} /> QUICK START
          </span>
          <h2 id="request-pertama">Request pertama dalam satu baris.</h2>
          <p>
            Buat API key gratis di dashboard, lalu kirim lewat header{" "}
            <code>X-API-Key</code>. Key Free berisi 1.000 request per bulan.
          </p>
          <Link href="/docs/guide/mulai-menggunakan" className="btn btn-ink">
            Ikuti quick start <Icon size={14} />
          </Link>
        </div>
        <CodeBlock
          code={code}
          language={lang}
          head={<LanguageTabs value={lang} onChange={setLang} />}
        />
      </div>
      <h2 id="pilih-jalur">Pilih jalurmu</h2>
      <div className="tile-grid">
        {[
          [
            "API reference",
            catalog.routes.length +
              " method dan route, lengkap dengan parameter dan contoh output.",
            "/docs/reference",
            "code",
          ],
          [
            "Autentikasi",
            "Akses publik dan API key untuk aplikasi server.",
            "/docs/guide/autentikasi-dan-integrasi",
            "key",
          ],
          [
            "Live & recent",
            "Rekap sesi, gold, screenshot, dan rekaman.",
            "/docs/guide/live-dan-recent",
            "live",
          ],
          [
            "Markdown lab",
            "Tabel, syntax highlight, Mermaid, matematika, dan catatan kaki.",
            "/docs/guide/markdown",
            "markdown",
          ],
        ].map(([title, text, href, icon]) => (
          <Link href={href} key={title} className="tile">
            <span className="tile-icon">
              <PixelIcon name={icon} size={18} />
            </span>
            <h3>{title}</h3>
            <p>{text}</p>
            <span className="round-arrow">
              <Icon size={15} />
            </span>
          </Link>
        ))}
      </div>
      <h2 id="sebelum-memulai">Sebelum memulai</h2>
      <div className="note">
        <span className="note-icon">
          <PixelIcon name="info" size={16} />
        </span>
        <div>
          <strong>Kenali bentuk responsnya.</strong>
          <p>
            Respons mengikuti endpoint: JSON, teks, gambar, atau playlist. Tidak
            ada satu envelope sukses yang dipakai semua route. Cek contoh di
            referensi sebelum melakukan parsing.
          </p>
        </div>
      </div>
      <dl className="facts" data-pip="overview-baseurl">
        <div>
          <dt>BASE URL</dt>
          <dd className="fact-row">
            <code>{BASE}</code>
            <Copy text={BASE} />
          </dd>
        </div>
        <div>
          <dt>FORMAT</dt>
          <dd className="fact-row">
            <LangLogo language="json" size={16} /> JSON · UTF-8
          </dd>
        </div>
        <div>
          <dt>WAKTU</dt>
          <dd>
            UTC (ISO 8601). Tampilkan WIB dengan <code>Asia/Jakarta</code>.
          </dd>
        </div>
      </dl>
      <h2 id="semua-panduan">Semua panduan</h2>
      <div className="index-list">
        {list.map((g, i) => (
          <Link key={g.slug} href={"/docs/guide/" + g.slug}>
            <span className="index-icon">
              <PixelIcon name={guideIcon(g.slug)} size={14} />
            </span>
            <span className="num">{String(i + 1).padStart(2, "0")}</span>
            <span className="title">{g.title}</span>
            <span className="leader" aria-hidden="true" />
            <Icon size={14} />
          </Link>
        ))}
      </div>
    </>
  );
}

function Endpoint({ route }) {
  const [values, setValues] = useState(() => initialParams(route)),
    [language, setLanguage] = useState("curl"),
    [output, setOutput] = useState(null),
    [busy, setBusy] = useState(false),
    // The visitor's own key, kept only in this browser for the Try button.
    [apiKey, setApiKey] = useState(() => {
      try {
        return localStorage.getItem("jkt48connect.tryKey") || "";
      } catch {
        return "";
      }
    }),
    abort = useRef(),
    response = useRef(),
    motionEnabled = useMotionEnabled();
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (output && motionEnabled && response.current)
      gsap.fromTo(
        response.current,
        { y: 14, autoAlpha: 0.2 },
        { y: 0, autoAlpha: 1, duration: 0.6, ease: "expo.out" },
      );
  }, [output]);
  const code = requestCode(route, values, language),
    pathNames = [...route.path.matchAll(/:([a-z_]+)/g)].map((m) => m[1]),
    sample = route.response?.body ?? route.successExample,
    tryable = canTry(route);
  let preview = "";
  try {
    preview = requestUrl(route, values).toString();
  } catch {}
  async function run() {
    if (!tryable) return;
    setBusy(true);
    setOutput(null);
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const timer = setTimeout(() => controller.abort(), 15000),
      started = performance.now();
    try {
      const generated = requestUrl(route, values, location.origin);
      if (generated.origin !== location.origin)
        throw Error("Origin tidak diizinkan");
      const result = await fetch(generated, {
        method: "GET",
        credentials: "omit",
        redirect: "error",
        headers: {
          Accept: "application/json",
          ...(apiKey.trim() ? { "X-API-Key": apiKey.trim() } : {}),
        },
        signal: controller.signal,
      });
      const reader = result.body.getReader(),
        chunks = [];
      let size = 0,
        truncated = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 131072) {
          truncated = true;
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
      const decoder = new TextDecoder();
      const text =
        chunks.map((c) => decoder.decode(c, { stream: true })).join("") +
        decoder.decode();
      let body = text;
      try {
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch {}
      setOutput({
        status: result.status,
        body: body + (truncated ? "\n… Preview dibatasi 128 KiB." : ""),
        ok: result.ok,
        ms: Math.round(performance.now() - started),
        size,
      });
    } catch (error) {
      setOutput({
        status: 0,
        body:
          error.name === "AbortError"
            ? "Request melewati 15 detik. Coba kembali."
            : "Request tidak berhasil. Periksa parameter dan coba kembali.",
        ok: false,
      });
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }
  return (
    <>
      <header className="page-head endpoint-head">
        <div className="crumbs">
          <span className="crumb-icon">
            <PixelIcon name="code" size={13} />
          </span>
          <Link href="/docs/reference">reference</Link>
          <span className="sep">/</span>
          <span>{route.group.toLowerCase()}</span>
        </div>
        <div className="endpoint-title">
          <span className={"method " + route.method}>{route.method}</span>
          <h1>
            {route.path.split(/(:[a-z_]+)/g).map((part, i) =>
              part.startsWith(":") ? (
                <span key={i} className="path-param">
                  {part}
                </span>
              ) : (
                part
              ),
            )}
          </h1>
        </div>
        <div className="meta-row">
          <span
            className={
              "meta " + (route.auth === "Publik" ? "public" : "private")
            }
          >
            <i /> {route.auth}
          </span>
          <span className="meta">
            {route.contentType || "Respons mengikuti endpoint"}
          </span>
          {route.source && (
            <a
              className="meta link"
              href={route.source}
              target="_blank"
              rel="noreferrer"
            >
              Implementasi <Icon name="external" size={12} />
            </a>
          )}
        </div>
      </header>
      <Suspense fallback={<p className="loading-note">Memuat deskripsi…</p>}>
        <MarkdownContent source={route.description} />
      </Suspense>
      <h2 id="parameters">Parameter</h2>
      <div className="playground" data-pip="endpoint-params">
        {Object.keys(values).length ? (
          <div className="params">
            {Object.entries(values).map(([name, value]) => (
              <label key={name} className="param-row">
                <span className="param-name">
                  <code>{name}</code>
                  <span className="location-tag">
                    {pathNames.includes(name) ? "path" : "query"}
                  </span>
                </span>
                <input
                  aria-label={"Parameter " + name}
                  value={value}
                  spellCheck={false}
                  onChange={(e) =>
                    setValues({ ...values, [name]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
        ) : (
          <p className="muted pad">
            Contoh dasar tidak memerlukan parameter tambahan.
          </p>
        )}
        {preview && (
          <div className="url-preview" data-pip="endpoint-url">
            <span className={"method " + route.method}>{route.method}</span>
            <code>{preview}</code>
            <Copy text={preview} label="URL" />
          </div>
        )}
      </div>
      {route.body && (
        <>
          <h2 id="request-body">Request body</h2>
          <CodeBlock
            code={JSON.stringify(route.body, null, 2)}
            language="json"
            label={route.contentType}
          />
        </>
      )}
      <h2 id="request-example">Contoh request</h2>
      <div data-pip="endpoint-request">
        <CodeBlock
          code={code}
          language={language}
          head={<LanguageTabs value={language} onChange={setLanguage} />}
        />
      </div>
      {!tryable && (
        <p className="caption">
          Contoh memakai placeholder. Endpoint ini tidak dijalankan dari halaman
          docs.
        </p>
      )}
      {tryable && (
        <label className="try-key" data-pip="try-key">
          <span>
            <PixelIcon name="key" size={11} /> API key untuk mencoba
          </span>
          <input
            type="password"
            value={apiKey}
            placeholder="jkc_…"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setApiKey(e.target.value);
              try {
                localStorage.setItem("jkt48connect.tryKey", e.target.value);
              } catch {}
            }}
          />
          <small>
            Disimpan hanya di browser ini. Belum punya?{" "}
            <Link href="/dashboard/keys">Buat API key gratis</Link>
          </small>
        </label>
      )}
      <div className="response-head">
        <h2 id="response">Respons</h2>
        {tryable && (
          <button
            type="button"
            className={"btn btn-ink run-button " + (busy ? "busy" : "")}
            data-pip="endpoint-try"
            disabled={busy}
            onClick={run}
          >
            <span className="run-dot" aria-hidden="true" />
            {busy ? "Mengirim…" : "Coba GET"}
          </button>
        )}
      </div>
      <div ref={response} data-pip="endpoint-response">
        <CodeBlock
          language="json"
          head={
            <span className="response-label">
              <LangLogo language="json" size={16} />
              <span
                className={
                  "status-pill " + (output ? (output.ok ? "ok" : "error") : "")
                }
              >
                {output
                  ? "HTTP " + (output.status || "—")
                  : route.response
                    ? "HTTP " + route.response.status
                    : "CONTOH"}
              </span>
              <span className="response-note">
                {output
                  ? "Langsung" +
                    (output.ms ? " · " + output.ms + " ms" : "") +
                    (output.size
                      ? " · " + (output.size / 1024).toFixed(1) + " KiB"
                      : "")
                  : route.responseLabel || "Contoh berdasarkan source"}
              </span>
            </span>
          }
          code={
            output?.body ??
            (sample === undefined
              ? "Contoh output belum tersedia untuk route ini. Lihat implementasi dan panduan autentikasi."
              : JSON.stringify(shortResponse(sample), null, 2))
          }
        />
      </div>
      <p className="caption">
        Array contoh ditampilkan maksimal dua item.{" "}
        <a href="/docs/responses.json" download>
          Unduh arsip output lengkap ↓
        </a>
      </p>
      {route.successExample && route.response && (
        <details className="extra-example">
          <summary>
            <LangLogo language="json" size={15} /> Contoh sukses dari source
          </summary>
          <CodeBlock
            code={JSON.stringify(route.successExample, null, 2)}
            language="json"
          />
        </details>
      )}
    </>
  );
}

export function Reference({ catalog, search }) {
  const query = new URLSearchParams(search),
    selected = catalog.routes.find((r) => routeKey(r) === query.get("route")),
    [filter, setFilter] = useState(query.get("q") || ""),
    [method, setMethod] = useState(""),
    [group, setGroup] = useState(query.get("group") || ""),
    listRef = useRef(),
    motionEnabled = useMotionEnabled();
  useEffect(() => setGroup(query.get("group") || ""), [search]);
  useEffect(() => setFilter(query.get("q") || ""), [search]);
  useEffect(() => {
    if (!motionEnabled || !listRef.current) return;
    const tween = gsap.from(listRef.current.children, {
      y: 10,
      autoAlpha: 0,
      duration: 0.45,
      stagger: 0.015,
      ease: "expo.out",
      clearProps: "transform,opacity,visibility",
    });
    return () => tween.revert();
  }, [method, group, motionEnabled]);
  if (selected) return <Endpoint route={selected} key={routeKey(selected)} />;
  const methods = [...new Set(catalog.routes.map((r) => r.method))];
  const routes = catalog.routes.filter(
    (r) =>
      (!method || r.method === method) &&
      (!group || r.group === group) &&
      (r.path + " " + r.description + " " + r.group)
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  return (
    <>
      <PageHead
        icon="code"
        crumbs={["docs", "reference"]}
        title={
          <>
            Temukan <span className="soft">jalur datamu.</span>
          </>
        }
        lead={
          catalog.routes.length +
          " kombinasi method dan route, dari data publik sampai media. Periksa label akses pada setiap endpoint."
        }
      />
      <div className="filter-bar">
        <label className="filter-search" data-pip="reference-search">
          <Icon name="search" size={16} />
          <input
            aria-label="Cari endpoint"
            placeholder="Cari endpoint atau fungsi…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <span className="filter-count">
            {routes.length}/{catalog.routes.length}
          </span>
        </label>
        <div
          className="segmented"
          role="group"
          aria-label="Filter method"
          data-pip="reference-filters"
        >
          {["", ...methods].map((m) => (
            <button
              type="button"
              key={m || "all"}
              aria-pressed={method === m}
              onClick={() => setMethod(m)}
            >
              {m || "Semua"}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Filter grup">
          {["", ...groups].map((g) => (
            <button
              type="button"
              key={g || "all"}
              aria-pressed={group === g}
              onClick={() => setGroup(g)}
            >
              {g || "Semua grup"}
            </button>
          ))}
        </div>
      </div>
      <div className="route-list" ref={listRef} data-pip="reference-list">
        {routes.map((r) => (
          <Link href={routeHref(r)} key={routeKey(r)} className="route-item">
            <span className={"method " + r.method}>{r.method}</span>
            <span className="route-main">
              <code>{r.path}</code>
              <span>{r.description.replace(/[`*]/g, "").slice(0, 140)}</span>
            </span>
            <span
              className={"auth-tag " + (r.auth === "Publik" ? "public" : "")}
            >
              {r.auth}
            </span>
            <span className="round-arrow small">
              <Icon size={13} />
            </span>
          </Link>
        ))}
      </div>
      {!routes.length && (
        <div className="empty-state">
          <pre aria-hidden="true">{"╭───────╮\n│ ? . ? │\n╰───────╯"}</pre>
          <h2>Belum ketemu.</h2>
          <p>Coba kata kunci lain atau hapus filter.</p>
          <button
            type="button"
            className="btn btn-soft"
            onClick={() => {
              setFilter("");
              setMethod("");
              setGroup("");
            }}
          >
            Hapus filter
          </button>
        </div>
      )}
    </>
  );
}

export function Toc({ article, page }) {
  const [headings, set] = useState([]),
    [active, setActive] = useState(""),
    nav = useRef(),
    marker = useLiquid(nav, "a.active", [active, headings.length], "y");
  useEffect(() => {
    let io;
    const update = () => {
      const nodes = [
        ...(article.current?.querySelectorAll("h2[id],h3[id]") || []),
      ];
      set(
        nodes.map((h) => ({ id: h.id, text: h.textContent, level: h.tagName })),
      );
      io?.disconnect();
      io = new IntersectionObserver(
        (entries) => {
          const top = entries
            .filter((e) => e.isIntersecting)
            .sort(
              (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
            )[0];
          if (top) setActive(top.target.id);
        },
        { rootMargin: "-90px 0px -60% 0px" },
      );
      nodes.forEach((n) => io.observe(n));
    };
    update();
    const observer = new MutationObserver(update);
    if (article.current)
      observer.observe(article.current, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      io?.disconnect();
    };
  }, [page]);
  return (
    <div className="toc-inner" data-pip="toc">
      {headings.length > 0 && (
        <>
          <span className="side-label">DI HALAMAN INI</span>
          <nav aria-label="Daftar isi halaman" ref={nav} className="toc-nav">
            <span className="toc-marker" ref={marker} aria-hidden="true" />
            {headings.slice(0, 40).map((h) => (
              <a
                key={h.id}
                href={"#" + h.id}
                className={
                  (h.level === "H3" ? "nested " : "") +
                  (active === h.id ? "active" : "")
                }
              >
                {h.text}
              </a>
            ))}
          </nav>
        </>
      )}
      <div className="toc-card">
        <AsciiScene
          shape="cube"
          size={7}
          speed={0.5}
          pitch={0.6}
          className="toc-ascii"
        />
        <strong>Ada yang kurang?</strong>
        <a href={GitHub + "/issues"} target="_blank" rel="noreferrer">
          Buka issue <Icon name="external" size={12} />
        </a>
        <a href="/docs/guide.md" download>
          Unduh Markdown <Icon name="down" size={12} />
        </a>
      </div>
    </div>
  );
}

export function Guide({ page, guides }) {
  const [edit, setEdit] = useState(false),
    [source, setSource] = useState(page.content),
    index = guides.findIndex((g) => g.slug === page.slug),
    minutes = Math.max(1, Math.ceil(page.content.split(/\s+/).length / 220));
  return (
    <>
      <PageHead
        icon={guideIcon(page.slug)}
        crumbs={["docs", "panduan", String(index + 1).padStart(2, "0")]}
        title={page.title}
      >
        <div className="meta-row">
          <span className="meta">
            <PixelIcon name="clock" size={11} /> {minutes} menit baca
          </span>
          <span className="meta public">
            <i /> Publik
          </span>
        </div>
      </PageHead>
      {page.slug === "markdown" && (
        <div className="lab-controls">
          <button
            type="button"
            className="btn btn-ink"
            data-pip="markdown-editor"
            onClick={() => setEdit(!edit)}
          >
            <LangLogo language="markdown" size={16} />
            {edit ? "Tutup editor" : "Coba Markdown sendiri"}
          </button>
          {edit && (
            <button
              type="button"
              className="btn btn-soft"
              onClick={() => setSource(page.content)}
            >
              Reset contoh
            </button>
          )}
        </div>
      )}
      {edit && (
        <label className="markdown-editor">
          <span>
            <LangLogo language="markdown" size={14} /> MARKDOWN SOURCE
          </span>
          <textarea
            aria-label="Editor Markdown"
            spellCheck={false}
            value={source}
            onChange={(e) => setSource(e.target.value.slice(0, 100000))}
          />
        </label>
      )}
      <div data-pip="guide-content">
        <Suspense
          fallback={<p className="loading-note">Menyiapkan panduan…</p>}
        >
          <MarkdownContent source={source} />
        </Suspense>
      </div>
      <div className="pager">
        {index > 0 ? (
          <Link href={"/docs/guide/" + guides[index - 1].slug}>
            <small>← Sebelumnya</small>
            <span>
              <PixelIcon name={guideIcon(guides[index - 1].slug)} size={14} />
              {guides[index - 1].title}
            </span>
          </Link>
        ) : (
          <span />
        )}
        {index < guides.length - 1 && (
          <Link className="next" href={"/docs/guide/" + guides[index + 1].slug}>
            <small>Selanjutnya →</small>
            <span>
              {guides[index + 1].title}
              <PixelIcon name={guideIcon(guides[index + 1].slug)} size={14} />
            </span>
          </Link>
        )}
      </div>
    </>
  );
}

export function NotFound() {
  return (
    <div className="not-found">
      <pre aria-hidden="true">
        {"█  █  ▄▀▀▄  █  █\n█▄▄█  █  █  █▄▄█\n   █  ▀▄▄▀     █"}
      </pre>
      <PageHead
        icon="search"
        crumbs={["docs", "404"]}
        title="Jalur ini belum ada."
        lead="Temukan halaman lain melalui pencarian atau kembali ke dokumentasi."
      />
      <Link href="/docs" className="btn btn-ink">
        Kembali ke docs <Icon size={14} />
      </Link>
    </div>
  );
}

export function DocsColophon() {
  return (
    <footer className="docs-colophon">
      <AsciiFriend />
      <span>JKT48Connect / catatan untuk ide berikutnya.</span>
      <a href="/docs/guide.md" download>
        Catatan .md <Icon name="down" size={12} />
      </a>
    </footer>
  );
}

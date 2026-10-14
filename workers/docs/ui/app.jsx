import { motion, useMotionEnabled } from "./motion.js";
import { AsciiFriend } from "./personality.jsx";
import { AsciiScene } from "./ascii-scene.jsx";
import React, {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import {
  routeKey,
  routeHref,
  initialParams,
  requestUrl,
  requestCode,
  canTry,
  shortResponse,
} from "./request.js";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/doto";
import "./theme.css";
const MarkdownContent = lazy(() => import("./markdown.jsx"));
gsap.registerPlugin(ScrollTrigger, ScrambleTextPlugin);
const GitHub = "https://github.com/Valzyys/jkt48showroom-api";
const BASE = "https://api.jkt48connect.app";
const groups = ["Publik", "Media"];
const SCRAMBLE_CHARS = "01<>/_#*+=.:";

function Icon({ name = "arrow", size = 18, ...props }) {
  const paths = {
    arrow: "M5 12h14m-6-6 6 6-6 6",
    search: "m20 20-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
    menu: "M4 8h16M4 16h16",
    close: "m6 6 12 12M6 18 18 6",
    code: "m8 6-6 6 6 6m8-12 6 6-6 6",
    book: "M12 6v15M3 3l9 3 9-3v15l-9 3-9-3Z",
    copy: "M8 8h13v13H8zM3 16V3h13",
    external: "M14 3h7v7m0-7L10 14M9 3H3v18h18v-6",
    check: "m4 12 5 5L20 6",
    play: "m7 4 13 8-13 8Z",
    pause: "M8 5v14M16 5v14",
    down: "M12 4v15m-6-6 6 6 6-6",
    up: "M12 20V5m-6 6 6-6 6 6",
    hash: "M5 9h15M4 15h15M10 3 8 21M16 3l-2 18",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name] || paths.arrow} />
    </svg>
  );
}
function Mark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 4h10v5H9v5H4zm14 0h10v10h-5V9h-5zM4 18h5v5h5v5H4zm19 0h5v10H18v-5h5z"
      />
      <rect x="13" y="13" width="6" height="6" fill="var(--accent)" />
    </svg>
  );
}
function Link({ href, children, onClick, ...props }) {
  return (
    <a
      href={href}
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (
          e.defaultPrevented ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey ||
          e.button !== 0 ||
          !href?.startsWith("/") ||
          props.target ||
          props.download !== undefined
        )
          return;
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}
function navigate(href) {
  history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
  document.getElementById("mobile-nav")?.close();
  window.scrollTo({ top: 0, behavior: "instant" });
}
function useLocation() {
  const [value, set] = useState(
    location.pathname + location.search + location.hash,
  );
  useEffect(() => {
    const update = () =>
      set(location.pathname + location.search + location.hash);
    addEventListener("popstate", update);
    addEventListener("hashchange", update);
    return () => {
      removeEventListener("popstate", update);
      removeEventListener("hashchange", update);
    };
  }, []);
  return value;
}
function Copy({ text, label = "Salin", className = "" }) {
  const [done, set] = useState(false),
    timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={"copy-button " + className}
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          set(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => set(false), 1600);
        } catch {
          set(false);
        }
      }}
    >
      <Icon name={done ? "check" : "copy"} size={13} />
      <span>{done ? "Tersalin" : label}</span>
      <span className="sr-only" aria-live="polite">
        {done ? "Berhasil disalin" : ""}
      </span>
    </button>
  );
}

// Light tokenizer for the code shown outside Markdown: strings, keywords,
// comments, numbers, and JSON keys. Output is plain React text, never HTML.
const TOKENS =
  /(\/\/[^\n]*|(?:^|\s)#[^\n]*)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|\b(const|let|await|async|import|from|return|if|throw|new|def|print|True|False|None|null|true|false|curl)\b|(-?\b\d+(?:\.\d+)?\b)/g;
function tint(code) {
  const out = [];
  let last = 0,
    m,
    i = 0;
  TOKENS.lastIndex = 0;
  if (code.length > 60000) return code;
  while ((m = TOKENS.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const [text, comment, string, keyword] = m,
      kind = comment
        ? "tk-comment"
        : string
          ? /^\s*:/.test(code.slice(m.index + text.length))
            ? "tk-key"
            : "tk-string"
          : keyword
            ? "tk-keyword"
            : "tk-number";
    out.push(
      <span key={i++} className={kind}>
        {text}
      </span>,
    );
    last = m.index + text.length;
  }
  out.push(code.slice(last));
  return out;
}

// Shared entrance choreography: fade-up blocks, scrambled mono labels,
// drawn rules, and counters. Everything is skipped when motion is off.
function useReveal(scope, deps = []) {
  const motionEnabled = useMotionEnabled();
  useEffect(() => {
    if (!motionEnabled || !scope.current) return;
    const context = gsap.context(() => {
      gsap.utils.toArray(".rv").forEach((el) =>
        gsap.from(el, {
          y: 26,
          autoAlpha: 0,
          duration: 0.8,
          ease: "power3.out",
          delay: Number(el.dataset.delay || 0),
          scrollTrigger: { trigger: el, start: "top 90%", once: true },
          clearProps: "opacity,visibility,transform",
        }),
      );
      gsap.utils.toArray("[data-scramble]").forEach((el) => {
        const text = el.textContent;
        gsap.to(el, {
          duration: Math.min(1.4, 0.35 + text.length * 0.025),
          scrambleText: { text, chars: SCRAMBLE_CHARS, speed: 0.6 },
          scrollTrigger: { trigger: el, start: "top 92%", once: true },
        });
      });
      gsap.utils.toArray(".rule-draw").forEach((el) =>
        gsap.from(el, {
          scaleX: 0,
          transformOrigin: "0 50%",
          duration: 1.1,
          ease: "power3.inOut",
          scrollTrigger: { trigger: el, start: "top 95%", once: true },
          clearProps: "transform",
        }),
      );
      gsap.utils.toArray("[data-count]").forEach((el) => {
        const value = Number(el.dataset.count),
          proxy = { v: 0 };
        gsap.to(proxy, {
          v: value,
          duration: 1.4,
          ease: "power2.out",
          scrollTrigger: { trigger: el, start: "top 92%", once: true },
          onUpdate: () => (el.textContent = Math.round(proxy.v)),
          onComplete: () => (el.textContent = value),
        });
      });
      gsap.utils.toArray(".bar-fill").forEach((el, i) =>
        gsap.from(el, {
          width: 0,
          duration: 1.1,
          ease: "steps(" + Math.max(1, el.textContent.length) + ")",
          delay: (i % 8) * 0.06,
          scrollTrigger: { trigger: el, start: "top 95%", once: true },
          clearProps: "width",
        }),
      );
    }, scope);
    let active = true;
    document.fonts.ready.then(() => active && ScrollTrigger.refresh());
    return () => {
      active = false;
      context.revert();
    };
  }, [motionEnabled, ...deps]);
}

function MotionToggle() {
  const enabled = useMotionEnabled();
  return (
    <button
      className="icon-button motion-toggle"
      type="button"
      aria-pressed={enabled}
      aria-label={enabled ? "Matikan animasi" : "Aktifkan animasi"}
      title={
        enabled
          ? "Animasi aktif. Klik untuk mematikan."
          : motion.getPreference() === "auto"
            ? "Animasi mengikuti pengaturan perangkat. Klik untuk mengaktifkan."
            : "Animasi mati. Klik untuk mengaktifkan."
      }
      onClick={() => motion.setEnabled(!enabled)}
    >
      <Icon name={enabled ? "pause" : "play"} size={14} />
      <span className="motion-label">{enabled ? "Motion" : "Static"}</span>
    </button>
  );
}
function Header({ onSearch, current, onMenu }) {
  const path = current.split(/[?#]/)[0];
  const nav = [
    ["/docs", "Docs", path === "/docs" || path.startsWith("/docs/guide/")],
    ["/docs/reference", "Reference", path === "/docs/reference"],
    ["/docs/guide/markdown", "Markdown", path === "/docs/guide/markdown"],
  ];
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="brand" aria-label="JKT48Connect, beranda">
          <Mark size={24} />
          <span className="brand-name">
            jkt48<b>connect</b>
          </span>
          <span className="brand-tag">/ developers</span>
        </Link>
        <nav className="main-nav" aria-label="Navigasi utama">
          {nav.map(([href, label, active]) => (
            <Link
              key={href}
              href={href}
              className={active ? "current" : ""}
              aria-current={active ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
          <a href={GitHub} target="_blank" rel="noreferrer">
            GitHub <Icon name="external" size={12} />
          </a>
        </nav>
        <div className="header-actions">
          <button
            type="button"
            className="search-trigger"
            onClick={onSearch}
            aria-label="Cari dokumentasi"
          >
            <Icon name="search" size={15} />
            <span>Cari…</span>
            <kbd>⌘K</kbd>
          </button>
          <MotionToggle />
          <Link
            href="/docs/guide/mulai-menggunakan"
            className="button button-solid header-cta"
          >
            Mulai <Icon size={14} />
          </Link>
          <button
            type="button"
            className="icon-button menu-trigger"
            onClick={onMenu}
            aria-label="Buka navigasi"
          >
            <Icon name="menu" />
          </button>
        </div>
      </div>
      <div className="reading-progress" />
    </header>
  );
}
function Cross({ className = "" }) {
  return <span className={"cross " + className} aria-hidden="true" />;
}
function SectionHead({ index, label, title, muted, text, align = "split" }) {
  return (
    <div className={"section-head " + align}>
      <div>
        <span className="eyebrow">
          <i />
          <span data-scramble>{`${index} / ${label}`}</span>
        </span>
        <h2 className="rv">
          {title} {muted && <span className="muted-text">{muted}</span>}
        </h2>
      </div>
      {text && (
        <p className="rv" data-delay="0.1">
          {text}
        </p>
      )}
    </div>
  );
}

function Landing({ catalog, guides }) {
  const scope = useRef(),
    motionEnabled = useMotionEnabled(),
    newsRoute = catalog.routes.find(
      (r) => r.method === "GET" && r.path === "/api/news",
    ) || { method: "GET", path: "/api/news", auth: "Publik", query: {} },
    [lang, setLang] = useState("javascript");
  useReveal(scope);
  useEffect(() => {
    if (!motionEnabled) return;
    const context = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power4.out" } });
      tl.from(".hero-line > span", {
        yPercent: 110,
        duration: 1.1,
        stagger: 0.09,
        clearProps: "transform",
      })
        .from(
          ".hero-fade",
          {
            y: 16,
            autoAlpha: 0,
            duration: 0.8,
            stagger: 0.07,
            clearProps: "opacity,visibility,transform",
          },
          "-=0.75",
        )
        .from(
          ".hero-stage",
          { autoAlpha: 0, duration: 0.9, clearProps: "opacity,visibility" },
          "-=0.9",
        );
      gsap.to(".hero-pixel", {
        duration: 1.2,
        delay: 0.35,
        scrambleText: {
          text: "karyamu.",
          chars: "▓▒░#*+=-.",
          speed: 0.5,
        },
      });
    }, scope);
    return () => context.revert();
  }, [motionEnabled]);
  const code = requestCode(newsRoute, initialParams(newsRoute), lang);
  const counts = [
    ["News", "/api/news"],
    ["Member", "/api/member"],
    ["Theater", "/api/theater"],
    ["Live", "/api/idn"],
    ["Now live", "/api/now_live"],
    ["Recent", "/api/recent"],
    ["Media", "media"],
  ]
    .map(([group, q]) => ({
      group,
      q,
      count: catalog.routes.filter((r) =>
        q === "media" ? r.group === "Media" : r.path.startsWith(q),
      ).length,
    }))
    .filter((x) => x.count);
  const max = Math.max(1, ...counts.map((x) => x.count));
  const strip = [
    ["NEWS", "/api/news"],
    ["MEMBER", "/api/member"],
    ["THEATER", "/api/theater"],
    ["NOW LIVE", "/api/now_live"],
    ["RECENT", "/api/recent"],
    ["SCREENSHOT", "/api/screenshots/:id"],
  ];
  return (
    <div className="landing" ref={scope}>
      <section className="hero frame-section" data-ascii-stage>
        <Cross className="tl" />
        <Cross className="tr" />
        <div className="hero-copy">
          <span className="chip hero-fade">
            <b>API</b>
            <span>
              PUBLIK · {catalog.routes.length} ENDPOINT · v{catalog.version}
            </span>
          </span>
          <h1 className="hero-title">
            <span className="hero-line">
              <span>Dari oshi.</span>
            </span>
            <span className="hero-line">
              <span>
                Jadi <em className="hero-pixel">karyamu.</em>
              </span>
            </span>
          </h1>
          <p className="hero-sub hero-fade">
            Berita, theater, live, dan cerita setelahnya. Data JKT48 yang
            terstruktur, siap dibawa ke aplikasi, bot, atau ide kecil yang belum
            sempat jadi.
          </p>
          <div className="hero-actions hero-fade">
            <Link
              href="/docs/guide/mulai-menggunakan"
              className="button button-solid"
            >
              Mulai membangun <Icon size={15} />
            </Link>
            <Link href="/docs/reference" className="button button-line">
              Lihat API <Icon name="code" size={15} />
            </Link>
          </div>
          <div className="terminal-line hero-fade">
            <span className="prompt">$</span>
            <code>
              curl {BASE.replace("https://", "")}
              /api/news
            </code>
            <i className="caret" aria-hidden="true" />
            <Copy text={"curl '" + BASE + "/api/news'"} />
          </div>
        </div>
        <div className="hero-stage">
          <div className="stage-meta top">
            <span>FIG. 048 — ONE CONNECTION</span>
            <span>LAT −6.20 / LON 106.82</span>
          </div>
          <AsciiScene
            shape="globe"
            size={11}
            speed={0.28}
            yaw={0.1}
            pitch={0.38}
            zoom={1.12}
            interactive
            className="hero-ascii"
          />
          <div className="stage-meta bottom">
            <span>
              <i className="live-dot" /> RENDER: ASCII / FLAT LIGHT
            </span>
            <span className="stage-hint">
              ARAHKAN KURSOR · KLIK UNTUK PUTAR
            </span>
          </div>
        </div>
      </section>

      <div className="ticker" aria-label="Kategori endpoint">
        <span className="ticker-label">
          <i /> DATA TERSEDIA
        </span>
        <div className="ticker-track">
          {[0, 1].map((copy) => (
            <div className="ticker-row" key={copy} aria-hidden={copy === 1}>
              {strip.map(([label, path]) => {
                const route = catalog.routes.find(
                  (r) => r.method === "GET" && r.path === path,
                );
                return (
                  <Link
                    key={label}
                    tabIndex={copy ? -1 : undefined}
                    href={route ? routeHref(route) : "/docs/reference"}
                  >
                    <span>[</span>
                    {label}
                    <span>]</span>
                    <small>{path}</small>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <section className="frame-section features">
        <Cross className="tl" />
        <Cross className="tr" />
        <SectionHead
          index="01"
          label="APA YANG BISA DIBUAT"
          title="Dibangun untuk proyek fans"
          muted="yang ingin tumbuh."
          text="Website fanbase, bot komunitas, atau proyek pertamamu. Mulai dari data yang sudah terstruktur, lalu tentukan sendiri bentuknya."
        />
        <div className="feature-grid">
          {[
            [
              "KABAR & PROFIL",
              "Kabar & profil member",
              "Berita, member, ulang tahun, dan jadwal theater dalam JSON yang rapi.",
              "/api/member",
              "cube",
            ],
            [
              "SAAT LIVE",
              "Live yang sedang berlangsung",
              "Showroom dan IDN Live dalam satu referensi, lengkap dengan penonton.",
              "/api/now_live",
              "torus",
            ],
            [
              "SETELAH LAYAR PADAM",
              "Recent, gift & replay",
              "Rekap sesi, gold per pengguna, screenshot, dan rekaman yang bisa diputar.",
              "/api/recent",
              "cross",
            ],
          ].map(([tag, title, text, path, shape], i) => (
            <Link
              key={tag}
              href={routeHref({ method: "GET", path })}
              className="feature-card rv"
              data-delay={i * 0.08}
            >
              <span className="tag">{tag}</span>
              <AsciiScene
                shape={shape}
                size={8}
                speed={0.42 + i * 0.07}
                yaw={i}
                pitch={0.5}
                zoom={1.12}
                className="feature-ascii"
              />
              <h3>{title}</h3>
              <p>{text}</p>
              <span className="card-link">
                <code>GET {path}</code>
                <Icon size={15} />
              </span>
            </Link>
          ))}
        </div>
        <div className="stat-band rv">
          <p>
            Satu katalog untuk semua <br />
            data yang kamu ikuti.
          </p>
          {[
            [catalog.routes.length, "Endpoint publik"],
            [guides.filter((g) => g.slug !== "markdown").length, "Panduan"],
            [0, "API key untuk mulai"],
          ].map(([value, label]) => (
            <div key={label}>
              <strong data-count={value}>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="frame-section first-request">
        <Cross className="tl" />
        <Cross className="tr" />
        <div className="request-copy">
          <SectionHead
            index="02"
            label="REQUEST PERTAMA"
            title="Satu request."
            muted="Mulai dari sini."
            align="stack"
          />
          <ol className="steps">
            {[
              ["Pilih endpoint", "Cari di reference atau tekan ⌘K."],
              ["Kirim request", "News dan member terbuka tanpa API key."],
              ["Bangun idemu", "Tampilkan, simpan, atau olah datanya."],
            ].map(([title, text], i) => (
              <li key={title} className="rv" data-delay={i * 0.08}>
                <span>0{i + 1}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ol>
          <Link
            className="button button-line"
            href="/docs/guide/mulai-menggunakan"
          >
            Buka quick start <Icon size={15} />
          </Link>
        </div>
        <div className="code-window rv" data-delay="0.1">
          <div className="window-bar">
            <div className="tabs" role="tablist" aria-label="Bahasa contoh">
              {[
                ["javascript", "JavaScript"],
                ["python", "Python"],
                ["curl", "cURL"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={lang === id}
                  onClick={() => setLang(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <Copy text={code} />
          </div>
          <pre className="code-body" tabIndex={0}>
            <code>{tint(code)}</code>
          </pre>
          <div className="window-response">
            <div className="response-bar">
              <span className="status-pill ok">200 OK</span>
              <span>application/json</span>
            </div>
            <pre>
              <code>
                {tint(
                  '{\n  "news": [ { "title": "…", "date": "2026-…" } ],\n  "page": 1,\n  "perpage": 10,\n  "total_count": 30\n}',
                )}
              </code>
            </pre>
          </div>
        </div>
      </section>

      <section className="frame-section coverage">
        <Cross className="tl" />
        <Cross className="tr" />
        <SectionHead
          index="03"
          label="PETA ENDPOINT"
          title="Ada jalan"
          muted="untuk setiap ide."
          text="Telusuri katalog berdasarkan jenis data. Setiap route punya parameter, label akses, dan contoh pemanggilan."
        />
        <div className="ascii-chart rv" role="list">
          <div className="chart-head" aria-hidden="true">
            <span>KATEGORI</span>
            <span>ROUTE</span>
            <span>JML</span>
          </div>
          {counts.map(({ group, count, q }) => {
            const cells = Math.max(1, Math.round((count / max) * 24));
            return (
              <Link
                role="listitem"
                key={group}
                href={
                  "/docs/reference?" +
                  (q === "media" ? "group=Media" : "q=" + encodeURIComponent(q))
                }
                className="chart-row"
                aria-label={group + ", " + count + " route"}
              >
                <span className="chart-label">{group}</span>
                <span className="bar" aria-hidden="true">
                  <span className="bar-fill">{"█".repeat(cells)}</span>
                  <span className="bar-rest">{"░".repeat(24 - cells)}</span>
                </span>
                <span className="chart-count">
                  {String(count).padStart(2, "0")}
                </span>
                <Icon size={14} />
              </Link>
            );
          })}
        </div>
      </section>

      <section className="frame-section flow">
        <Cross className="tl" />
        <Cross className="tr" />
        <SectionHead
          index="04"
          label="SEMUA TERHUBUNG"
          title="Dari satu sumber,"
          muted="ke banyak kemungkinan."
        />
        <div className="flow-diagram rv">
          {[
            ["SUMBER", ["SHOWROOM", "IDN LIVE", "JKT48.COM"]],
            ["JKT48CONNECT", ["NORMALISASI", "CACHE", "MEDIA R2"]],
            ["PROYEKMU", ["WEBSITE", "BOT", "DASHBOARD"]],
          ].map(([title, items], i) => (
            <React.Fragment key={title}>
              {i > 0 && (
                <div className="flow-wire" aria-hidden="true">
                  <span className="wire-line" />
                  <span className="wire-packet" />
                  <span className="wire-label">
                    {i === 1 ? "FETCH" : "JSON"}
                  </span>
                </div>
              )}
              <div className={"flow-node " + (i === 1 ? "core" : "")}>
                <span className="node-corner" aria-hidden="true">
                  {"┌─"}
                </span>
                <span className="node-index">0{i + 1}</span>
                <strong>{title}</strong>
                <ul>
                  {items.map((x) => (
                    <li key={x}>
                      <span aria-hidden="true">├─ </span>
                      {x}
                    </li>
                  ))}
                </ul>
                <span className="node-corner end" aria-hidden="true">
                  {"─┘"}
                </span>
              </div>
            </React.Fragment>
          ))}
        </div>
      </section>

      <section className="frame-section cta" data-ascii-stage>
        <Cross className="tl" />
        <Cross className="tr" />
        <div className="cta-copy">
          <span className="eyebrow">
            <i />
            <span data-scramble>YOUR NEXT COMMIT STARTS HERE</span>
          </span>
          <h2 className="rv">
            Ikuti datanya.
            <br />
            <span className="muted-text">Buat sesuatu.</span>
          </h2>
          <div className="hero-actions rv" data-delay="0.1">
            <Link className="button button-solid" href="/docs">
              Buka dokumentasi <Icon size={15} />
            </Link>
            <a
              className="button button-line"
              href={GitHub}
              target="_blank"
              rel="noreferrer"
            >
              Source <Icon name="external" size={14} />
            </a>
          </div>
        </div>
        <AsciiScene
          shape="48"
          size={9}
          zoom={1.2}
          sway={0.55}
          speed={0.7}
          yaw={-0.2}
          pitch={0.22}
          interactive
          className="cta-ascii"
        />
      </section>
      <Footer guides={guides} />
    </div>
  );
}

function Footer({ guides = [] }) {
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div className="footer-brand">
          <Link href="/" className="brand">
            <Mark size={24} />
            <span className="brand-name">
              jkt48<b>connect</b>
            </span>
          </Link>
          <p>
            Dari yang kita ikuti, untuk hal yang ingin kita buat. Proyek fans
            independen, dibuat dengan sedikit perhatian ekstra.
          </p>
          <AsciiFriend caption={"SMALL FRIEND.\nBIG FAN ENERGY."} />
        </div>
        <nav aria-label="Dokumentasi">
          <span className="footer-label">DOKUMENTASI</span>
          <Link href="/docs">Overview</Link>
          <Link href="/docs/reference">API reference</Link>
          <Link href="/docs/guide/mulai-menggunakan">Quick start</Link>
          <Link href="/docs/guide/markdown">Markdown lab</Link>
        </nav>
        <nav aria-label="Panduan populer">
          <span className="footer-label">PANDUAN</span>
          {guides
            .filter((g) => g.slug !== "markdown")
            .slice(2, 6)
            .map((g) => (
              <Link key={g.slug} href={"/docs/guide/" + g.slug}>
                {g.title}
              </Link>
            ))}
        </nav>
        <nav aria-label="Sumber">
          <span className="footer-label">SUMBER</span>
          <a href={GitHub} target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
          <a href={GitHub + "/issues"} target="_blank" rel="noreferrer">
            Laporkan masalah ↗
          </a>
          <a href="/docs/guide.md" download>
            Panduan .md ↓
          </a>
          <a href="/docs/routes.json">Katalog JSON</a>
        </nav>
      </div>
      <div className="footer-wordmark" aria-hidden="true">
        JKT48CONNECT
      </div>
      <div className="footer-bottom">
        <span>
          © {new Date().getFullYear()} JKT48Connect · crafted by Valzy
        </span>
        <span>Tidak berafiliasi dengan manajemen JKT48.</span>
        <button
          type="button"
          onClick={() =>
            window.scrollTo({
              top: 0,
              behavior: motion.getSnapshot() ? "smooth" : "instant",
            })
          }
        >
          Kembali ke atas <Icon name="up" size={13} />
        </button>
      </div>
    </footer>
  );
}

function Sidebar({ catalog, guides, current, onNavigate }) {
  const [filter, setFilter] = useState("");
  const list = guides.filter(
    (g) =>
      g.slug !== "markdown" &&
      g.title.toLowerCase().includes(filter.toLowerCase()),
  );
  const item = (href, label, active, extra) => (
    <Link
      onClick={onNavigate}
      href={href}
      className={active ? "selected" : ""}
      aria-current={active ? "page" : undefined}
    >
      {label}
      {extra}
    </Link>
  );
  return (
    <div className="sidebar-inner">
      <label className="sidebar-filter">
        <Icon name="search" size={14} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter panduan"
          aria-label="Filter navigasi panduan"
        />
      </label>
      <div className="side-group">
        <span className="side-label">MULAI</span>
        <nav aria-label="Dokumentasi utama" className="side-nav">
          {item(
            "/docs",
            "Overview",
            current === "/docs" || current === "/docs/",
          )}
          {item(
            "/docs/reference",
            "API Reference",
            current.startsWith("/docs/reference"),
            <small>{catalog.routes.length}</small>,
          )}
          {item(
            "/docs/guide/markdown",
            "Markdown lab",
            current.endsWith("/markdown"),
          )}
        </nav>
      </div>
      <div className="side-group">
        <span className="side-label">PANDUAN & INTEGRASI</span>
        <nav aria-label="Panduan dokumentasi" className="side-nav numbered">
          {list.map((g) => (
            <Link
              onClick={onNavigate}
              key={g.slug}
              href={"/docs/guide/" + g.slug}
              className={current === "/docs/guide/" + g.slug ? "selected" : ""}
              aria-current={
                current === "/docs/guide/" + g.slug ? "page" : undefined
              }
            >
              <span className="num">
                {String(
                  guides.filter((x) => x.slug !== "markdown").indexOf(g) + 1,
                ).padStart(2, "0")}
              </span>
              {g.title}
            </Link>
          ))}
          {!list.length && <p className="side-empty">Tidak ada panduan.</p>}
        </nav>
      </div>
      <div className="sidebar-foot">
        <span>
          <i className="live-dot" /> API ONLINE
        </span>
        <small>v{catalog.version}</small>
      </div>
    </div>
  );
}

function PageHead({ crumbs, title, lead, children }) {
  return (
    <header className="page-head">
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            <span>{c}</span>
          </React.Fragment>
        ))}
      </div>
      <h1>{title}</h1>
      {lead && <p className="lead">{lead}</p>}
      {children}
    </header>
  );
}

function Overview({ catalog, guides }) {
  const list = guides.filter((g) => g.slug !== "markdown");
  return (
    <>
      <div className="overview-hero">
        <PageHead
          crumbs={["docs", "overview"]}
          title={
            <>
              Buka catatannya. <span className="muted-text">Bangun idemu.</span>
            </>
          }
          lead="Kenali API, temukan endpoint, lalu hubungkan ke aplikasimu. Semua panduan dan referensi ada di sini."
        />
        <AsciiScene
          shape="torus"
          size={8}
          speed={0.5}
          pitch={0.9}
          className="overview-ascii"
        />
      </div>
      <div className="quick-panel">
        <div>
          <span className="eyebrow">
            <i /> QUICK START
          </span>
          <h2 id="request-pertama">Request pertama dalam satu baris.</h2>
          <p>
            News dan member terbuka tanpa API key. Untuk recent dan integrasi
            server, baca kebutuhan autentikasinya.
          </p>
          <Link href="/docs/guide/mulai-menggunakan" className="text-link">
            Ikuti quick start <Icon size={14} />
          </Link>
        </div>
        <div className="mini-terminal">
          <div className="window-bar">
            <span className="dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>terminal</span>
            <Copy text={"curl '" + BASE + "/api/news?page=1&perpage=10'"} />
          </div>
          <pre tabIndex={0}>
            <code>
              <span className="tk-comment">
                # endpoint publik · tanpa API key
              </span>
              {"\n"}
              {tint("curl '" + BASE + "/api/news?page=1&perpage=10'")}
            </code>
          </pre>
        </div>
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
            "hash",
          ],
          [
            "Live & recent",
            "Rekap sesi, gold, screenshot, dan rekaman.",
            "/docs/guide/live-dan-recent",
            "play",
          ],
          [
            "Markdown lab",
            "Tabel, syntax highlight, Mermaid, matematika, dan catatan kaki.",
            "/docs/guide/markdown",
            "book",
          ],
        ].map(([title, text, href, icon], i) => (
          <Link href={href} key={title} className="tile">
            <span className="tile-top">
              <Icon name={icon} size={18} />
              <span>0{i + 1}</span>
            </span>
            <h3>{title}</h3>
            <p>{text}</p>
            <Icon className="tile-arrow" size={15} />
          </Link>
        ))}
      </div>
      <h2 id="sebelum-memulai">Sebelum memulai</h2>
      <div className="note">
        <strong>Kenali bentuk responsnya.</strong>
        <p>
          Respons mengikuti endpoint: JSON, teks, gambar, atau playlist. Tidak
          ada satu envelope sukses yang dipakai semua route. Cek contoh di
          referensi sebelum melakukan parsing.
        </p>
      </div>
      <dl className="facts">
        <div>
          <dt>BASE URL</dt>
          <dd>
            <code>{BASE}</code>
            <Copy text={BASE} />
          </dd>
        </div>
        <div>
          <dt>FORMAT</dt>
          <dd>JSON · UTF-8</dd>
        </div>
        <div>
          <dt>WAKTU</dt>
          <dd className="prose">
            UTC (ISO 8601). Tampilkan WIB dengan <code>Asia/Jakarta</code>.
          </dd>
        </div>
      </dl>
      <h2 id="semua-panduan">Semua panduan</h2>
      <div className="index-list">
        {list.map((g, i) => (
          <Link key={g.slug} href={"/docs/guide/" + g.slug}>
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

function CodeBlock({ code, label, tinted = true, actions }) {
  return (
    <div className="code-block">
      <div className="code-toolbar">
        <span className="code-file-label">{label}</span>
        {actions}
        <Copy text={code} />
      </div>
      <pre tabIndex={0}>
        <code>{tinted ? tint(code) : code}</code>
      </pre>
    </div>
  );
}

function Endpoint({ route }) {
  const [values, setValues] = useState(() => initialParams(route)),
    [language, setLanguage] = useState("curl"),
    [output, setOutput] = useState(null),
    [busy, setBusy] = useState(false),
    abort = useRef();
  useEffect(() => () => abort.current?.abort(), []);
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
        headers: { Accept: "application/json" },
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
        <p className="muted">
          Contoh dasar tidak memerlukan parameter tambahan.
        </p>
      )}
      {preview && (
        <div className="url-preview">
          <span className={"method " + route.method}>{route.method}</span>
          <code>{preview}</code>
          <Copy text={preview} label="URL" />
        </div>
      )}
      {route.body && (
        <>
          <h2 id="request-body">Request body</h2>
          <CodeBlock
            code={JSON.stringify(route.body, null, 2)}
            label={route.contentType}
          />
        </>
      )}
      <h2 id="request-example">Contoh request</h2>
      <CodeBlock
        code={code}
        label={
          <span className="tabs" role="tablist" aria-label="Bahasa contoh">
            {[
              ["curl", "cURL"],
              ["javascript", "JavaScript"],
              ["python", "Python"],
            ].map(([lang, label]) => (
              <button
                type="button"
                key={lang}
                role="tab"
                aria-selected={language === lang}
                onClick={() => setLanguage(lang)}
              >
                {label}
              </button>
            ))}
          </span>
        }
      />
      {!tryable && (
        <p className="caption">
          Contoh memakai placeholder. Endpoint ini tidak dijalankan dari halaman
          docs.
        </p>
      )}
      <div className="response-head">
        <h2 id="response">Respons</h2>
        {tryable && (
          <button
            type="button"
            className={"button button-solid run-button " + (busy ? "busy" : "")}
            disabled={busy}
            onClick={run}
          >
            {busy ? "Mengirim…" : "Coba GET"}
            <Icon name="play" size={12} />
          </button>
        )}
      </div>
      <CodeBlock
        label={
          <span className="response-label">
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
            <span>
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
      <p className="caption">
        Array contoh ditampilkan maksimal dua item.{" "}
        <a href="/docs/responses.json" download>
          Unduh arsip output lengkap ↓
        </a>
      </p>
      {route.successExample && route.response && (
        <details className="extra-example">
          <summary>Contoh sukses dari source</summary>
          <CodeBlock
            code={JSON.stringify(route.successExample, null, 2)}
            label="json"
          />
        </details>
      )}
    </>
  );
}

function Reference({ catalog, search }) {
  const query = new URLSearchParams(search),
    selected = catalog.routes.find((r) => routeKey(r) === query.get("route")),
    [filter, setFilter] = useState(query.get("q") || ""),
    [method, setMethod] = useState(""),
    [group, setGroup] = useState(query.get("group") || "");
  useEffect(() => setGroup(query.get("group") || ""), [search]);
  useEffect(() => setFilter(query.get("q") || ""), [search]);
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
        crumbs={["docs", "reference"]}
        title={
          <>
            Temukan <span className="muted-text">jalur datamu.</span>
          </>
        }
        lead={
          catalog.routes.length +
          " kombinasi method dan route, dari data publik sampai media. Periksa label akses pada setiap endpoint."
        }
      />
      <div className="filter-bar">
        <label className="filter-search">
          <Icon name="search" size={15} />
          <input
            aria-label="Cari endpoint"
            placeholder="Cari endpoint atau fungsi…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <div className="segmented" role="group" aria-label="Filter method">
          {["", ...methods].map((m) => (
            <button
              type="button"
              key={m || "all"}
              aria-pressed={method === m}
              onClick={() => setMethod(m)}
            >
              {m || "ALL"}
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
              {g || "Semua"}
            </button>
          ))}
        </div>
      </div>
      <div className="result-count">
        <span>
          {String(routes.length).padStart(2, "0")} / {catalog.routes.length}{" "}
          ROUTE
        </span>
        <span className="rule" />
      </div>
      <div className="route-list">
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
            <Icon size={14} />
          </Link>
        ))}
      </div>
      {!routes.length && (
        <div className="empty-state">
          <pre aria-hidden="true">
            {"  ┌───────┐\n  │ ? . ? │\n  └───────┘"}
          </pre>
          <h2>Belum ketemu.</h2>
          <p>Coba kata kunci lain atau hapus filter.</p>
          <button
            type="button"
            className="button button-line"
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

function Toc({ article, page }) {
  const [headings, set] = useState([]),
    [active, setActive] = useState("");
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
        { rootMargin: "-80px 0px -65% 0px" },
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
    <div className="toc-inner">
      {headings.length > 0 && (
        <>
          <span className="side-label">DI HALAMAN INI</span>
          <nav aria-label="Daftar isi halaman">
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
        <span>Ada yang kurang?</span>
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

function Guide({ page, guides }) {
  const [edit, setEdit] = useState(false),
    [source, setSource] = useState(page.content),
    index = guides.findIndex((g) => g.slug === page.slug),
    minutes = Math.max(1, Math.ceil(page.content.split(/\s+/).length / 220));
  return (
    <>
      <PageHead
        crumbs={["docs", "panduan", String(index + 1).padStart(2, "0")]}
        title={page.title}
      >
        <div className="meta-row">
          <span className="meta">{minutes} MENIT BACA</span>
          <span className="meta public">
            <i /> PUBLIK
          </span>
        </div>
      </PageHead>
      {page.slug === "markdown" && (
        <div className="lab-controls">
          <button
            type="button"
            className="button button-solid"
            onClick={() => setEdit(!edit)}
          >
            {edit ? "Tutup editor" : "Coba Markdown sendiri"}
            <Icon name="code" size={14} />
          </button>
          {edit && (
            <button
              type="button"
              className="button button-line"
              onClick={() => setSource(page.content)}
            >
              Reset contoh
            </button>
          )}
        </div>
      )}
      {edit && (
        <label className="markdown-editor">
          <span>MARKDOWN SOURCE</span>
          <textarea
            aria-label="Editor Markdown"
            spellCheck={false}
            value={source}
            onChange={(e) => setSource(e.target.value.slice(0, 100000))}
          />
        </label>
      )}
      <Suspense fallback={<p className="loading-note">Menyiapkan panduan…</p>}>
        <MarkdownContent source={source} />
      </Suspense>
      <div className="pager">
        {index > 0 ? (
          <Link href={"/docs/guide/" + guides[index - 1].slug}>
            <small>← SEBELUMNYA</small>
            {guides[index - 1].title}
          </Link>
        ) : (
          <span />
        )}
        {index < guides.length - 1 && (
          <Link className="next" href={"/docs/guide/" + guides[index + 1].slug}>
            <small>SELANJUTNYA →</small>
            {guides[index + 1].title}
          </Link>
        )}
      </div>
    </>
  );
}

function SearchDialog({ open, onClose, catalog, guides }) {
  const ref = useRef(),
    input = useRef(),
    list = useRef(),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0);
  useEffect(() => {
    if (open) {
      ref.current.showModal();
      input.current?.focus();
      input.current?.select();
    } else ref.current?.close();
  }, [open]);
  const needle = query.trim().toLowerCase();
  const results = useMemo(() => {
    const pages = guides
      .filter((g) => (g.title + " " + g.content).toLowerCase().includes(needle))
      .slice(0, 5)
      .map((g) => ({
        kind: "PANDUAN",
        key: g.slug,
        href: "/docs/guide/" + g.slug,
        title: g.title,
        detail: g.content.replace(/[#*`>\-|\n]+/g, " ").slice(0, 96) + "…",
      }));
    const routes = catalog.routes
      .filter((r) =>
        (r.path + " " + r.description + " " + r.auth)
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, 8)
      .map((r) => ({
        kind: "ENDPOINT",
        key: routeKey(r),
        href: routeHref(r),
        title: r.path,
        method: r.method,
        detail: r.group + " · " + r.auth,
      }));
    return [...pages, ...routes];
  }, [needle, catalog, guides]);
  useEffect(() => setActive(0), [needle]);
  useEffect(() => {
    list.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  function key(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive(
        (a) => (a + step + results.length) % Math.max(1, results.length),
      );
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      onClose();
      navigate(results[active].href);
    }
  }
  return (
    <dialog
      ref={ref}
      className="search-dialog"
      onCancel={onClose}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label="Cari dokumentasi"
    >
      <div className="search-input">
        <Icon name="search" />
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls="search-results"
          aria-activedescendant={
            results[active] ? "result-" + active : undefined
          }
          aria-label="Pencarian dokumentasi"
          placeholder="Cari endpoint, panduan, atau topik…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={key}
        />
        <button type="button" onClick={onClose} aria-label="Tutup pencarian">
          <kbd>ESC</kbd>
        </button>
      </div>
      <div
        className="search-results"
        id="search-results"
        role="listbox"
        ref={list}
      >
        {!needle && (
          <p className="search-hint">
            Coba{" "}
            <button type="button" onClick={() => setQuery("recent")}>
              recent
            </button>
            <button type="button" onClick={() => setQuery("member")}>
              member
            </button>
            <button type="button" onClick={() => setQuery("gold")}>
              gold
            </button>
            <button type="button" onClick={() => setQuery("screenshot")}>
              screenshot
            </button>
          </p>
        )}
        {results.map((r, i) => (
          <React.Fragment key={r.kind + r.key}>
            {(i === 0 || results[i - 1].kind !== r.kind) && (
              <span className="search-category">{r.kind}</span>
            )}
            <Link
              id={"result-" + i}
              role="option"
              aria-selected={i === active}
              data-active={i === active}
              href={r.href}
              onClick={onClose}
              onMouseMove={() => i !== active && setActive(i)}
            >
              {r.method ? (
                <span className={"method " + r.method}>{r.method}</span>
              ) : (
                <Icon name="book" size={15} />
              )}
              <span className="result-text">
                {r.title}
                <small>{r.detail}</small>
              </span>
              <Icon size={14} />
            </Link>
          </React.Fragment>
        ))}
        {needle && !results.length && (
          <div className="search-empty">
            <pre aria-hidden="true">{"( . _ . )"}</pre>
            <p>Tidak ada hasil untuk “{query}”.</p>
          </div>
        )}
      </div>
      <div className="search-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> pilih <kbd>↵</kbd> buka
        </span>
        <span>JKT48CONNECT / SEARCH</span>
      </div>
    </dialog>
  );
}

function NotFound() {
  return (
    <div className="not-found">
      <pre aria-hidden="true">
        {"█  █  ▄▀▀▄  █  █\n█▄▄█  █  █  █▄▄█\n   █  ▀▄▄▀     █"}
      </pre>
      <PageHead
        crumbs={["docs", "404"]}
        title="Jalur ini belum ada."
        lead="Temukan halaman lain melalui pencarian atau kembali ke dokumentasi."
      />
      <Link href="/docs" className="button button-solid">
        Kembali ke docs <Icon size={14} />
      </Link>
    </div>
  );
}

function App({ catalog, guides }) {
  const motionEnabled = useMotionEnabled();
  const current = useLocation(),
    url = new URL(current, location.origin),
    docs = url.pathname.startsWith("/docs"),
    [searchOpen, setSearch] = useState(false),
    mobile = useRef(),
    article = useRef();
  const guide = guides.find((g) => url.pathname === "/docs/guide/" + g.slug),
    selected = catalog.routes.find(
      (r) => routeKey(r) === url.searchParams.get("route"),
    );
  useReveal(article, [url.pathname, url.search]);
  useEffect(() => {
    if (!motionEnabled || !docs) return;
    const target = document.querySelector("#main-content .docs-article");
    const animation =
      target &&
      gsap.fromTo(
        target.children,
        { opacity: 0, y: 12 },
        {
          opacity: 1,
          y: 0,
          duration: 0.5,
          stagger: 0.035,
          ease: "power3.out",
          clearProps: "opacity,transform",
        },
      );
    return () => animation?.revert();
  }, [url.pathname, url.search, motionEnabled]);
  useEffect(() => {
    const line = document.querySelector(".reading-progress");
    const update = () => {
      const length = document.documentElement.scrollHeight - innerHeight;
      line.style.transform =
        "scaleX(" + (length > 0 ? scrollY / length : 0) + ")";
    };
    addEventListener("scroll", update, { passive: true });
    update();
    return () => removeEventListener("scroll", update);
  }, []);
  useEffect(() => {
    function key(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch((v) => !v);
      } else if (
        e.key === "/" &&
        !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)
      ) {
        e.preventDefault();
        setSearch(true);
      }
    }
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    let observer;
    const scroll = () => {
      if (!location.hash || location.hash.startsWith("#route=")) return;
      let id;
      try {
        id = decodeURIComponent(location.hash.slice(1));
      } catch {
        return;
      }
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView();
        observer?.disconnect();
      }
    };
    observer = new MutationObserver(scroll);
    if (article.current)
      observer.observe(article.current, { subtree: true, childList: true });
    scroll();
    return () => observer.disconnect();
  }, [current]);
  useEffect(() => {
    document.title =
      (docs
        ? (guide?.title ||
            selected?.path ||
            (url.pathname === "/docs/reference"
              ? "API Reference"
              : "Dokumentasi")) + " · "
        : "") + "JKT48Connect Developers";
    if (location.hash.startsWith("#route=")) {
      try {
        const r = catalog.routes.find(
          (r) => routeKey(r) === decodeURIComponent(location.hash.slice(7)),
        );
        if (r) navigate(routeHref(r));
      } catch {}
    }
  }, [current]);
  const notFound =
    docs &&
    url.pathname !== "/docs" &&
    url.pathname !== "/docs/" &&
    url.pathname !== "/docs/reference" &&
    !guide;
  return (
    <>
      <a className="skip-link" href="#main-content">
        Lewati ke konten
      </a>
      <Header
        current={current}
        onSearch={() => setSearch(true)}
        onMenu={() => mobile.current.showModal()}
      />
      {docs ? (
        <div className="docs-layout">
          <aside className="docs-sidebar">
            <Sidebar catalog={catalog} guides={guides} current={url.pathname} />
          </aside>
          <main id="main-content" className="docs-main" ref={article}>
            <article className="docs-article" key={url.pathname + url.search}>
              {notFound ? (
                <NotFound />
              ) : guide ? (
                <Guide page={guide} guides={guides} key={guide.slug} />
              ) : url.pathname === "/docs/reference" ? (
                <Reference catalog={catalog} search={url.search} />
              ) : (
                <Overview catalog={catalog} guides={guides} />
              )}
            </article>
            <footer className="docs-colophon">
              <AsciiFriend />
              <span>JKT48Connect / catatan untuk ide berikutnya.</span>
              <a href="/docs/guide.md" download>
                Catatan .md <Icon name="down" size={12} />
              </a>
            </footer>
          </main>
          <aside className="docs-toc">
            <Toc article={article} page={current} />
          </aside>
        </div>
      ) : (
        <main id="main-content" className="landing-main">
          <Landing catalog={catalog} guides={guides} />
        </main>
      )}
      <SearchDialog
        open={searchOpen}
        onClose={() => setSearch(false)}
        catalog={catalog}
        guides={guides}
      />
      <dialog
        id="mobile-nav"
        className="mobile-nav"
        ref={mobile}
        aria-label="Navigasi dokumentasi"
        onClick={(e) => {
          if (e.target === e.currentTarget) mobile.current.close();
        }}
      >
        <div className="mobile-sheet">
          <div className="mobile-head">
            <Link
              href="/"
              className="brand"
              onClick={() => mobile.current.close()}
            >
              <Mark size={22} />
              <span className="brand-name">
                jkt48<b>connect</b>
              </span>
            </Link>
            <button
              type="button"
              className="icon-button"
              onClick={() => mobile.current.close()}
              aria-label="Tutup navigasi"
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="mobile-actions">
            <button
              type="button"
              className="search-trigger"
              onClick={() => {
                mobile.current.close();
                setSearch(true);
              }}
            >
              <Icon name="search" size={15} />
              <span>Cari dokumentasi…</span>
            </button>
            <MotionToggle />
          </div>
          <Sidebar
            catalog={catalog}
            guides={guides}
            current={url.pathname}
            onNavigate={() => mobile.current.close()}
          />
          <a
            className="mobile-github"
            href={GitHub}
            target="_blank"
            rel="noreferrer"
          >
            Source di GitHub <Icon name="external" size={13} />
          </a>
        </div>
      </dialog>
    </>
  );
}
class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="boot-error">
        <h1>Dokumentasi belum dapat ditampilkan.</h1>
        <p>Muat ulang halaman atau unduh panduan lengkap.</p>
        <a href="/docs/guide.md">Unduh Markdown ↓</a>
        <button type="button" onClick={() => location.reload()}>
          Muat ulang
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
const root = createRoot(document.getElementById("root"));
Promise.all([
  fetch("/docs/routes.json").then((r) => {
    if (!r.ok) throw Error();
    return r.json();
  }),
  fetch("/docs/pages.json").then((r) => {
    if (!r.ok) throw Error();
    return r.json();
  }),
])
  .then(([catalog, guides]) =>
    root.render(
      <ErrorBoundary>
        <App catalog={catalog} guides={guides} />
      </ErrorBoundary>,
    ),
  )
  .catch(() =>
    root.render(
      <div className="boot-error">
        <Mark size={36} />
        <h1>Koneksi dokumentasi terputus.</h1>
        <p>Coba muat ulang, atau baca panduan Markdown.</p>
        <a href="/docs/guide.md">Unduh panduan ↓</a>
        <button type="button" onClick={() => location.reload()}>
          Coba lagi
        </button>
      </div>,
    ),
  );

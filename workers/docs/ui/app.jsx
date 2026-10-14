import { motion, useMotionEnabled } from "./motion.js";
import { AsciiFriend, LittleBadge } from "./personality.jsx";
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
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
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
import "./style.css";
import "./redesign.css";
const Character = lazy(() => import("./character.jsx"));
const MarkdownContent = lazy(() => import("./markdown.jsx"));
gsap.registerPlugin(ScrollTrigger, MotionPathPlugin);
const GitHub = "https://github.com/Valzyys/jkt48showroom-api";
const groups = ["Publik", "Media"];
const monoFace = String.raw`    /\___/\
   ( o   o )
    >  _  <
 .--|-----|--.
 |  | 48  |  |
 '--|_____|--'
     /   \
   (_)   (_)`;
function Icon({ name = "arrow", size = 18, ...props }) {
  const paths = {
    arrow: "M5 12h14m-6-6 6 6-6 6",
    search: "m20 20-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
    menu: "M4 7h16M4 12h16M4 17h16",
    close: "m6 6 12 12M6 18 18 6",
    code: "m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18",
    book: "M12 6v15M3 3l9 3 9-3v15l-9 3-9-3Z",
    copy: "M8 8h13v13H8zM3 16V3h13",
    sun: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    chevron: "m9 5 7 7-7 7",
    external: "M14 3h7v7m0-7L10 14M9 3H3v18h18v-6",
    check: "m4 12 5 5L20 6",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
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
      <circle cx="16" cy="16" r="4" fill="var(--red)" />
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
          props.target
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
      {done ? (
        <>
          <Icon name="check" size={13} />
          Tersalin
        </>
      ) : (
        <>
          <Icon name="copy" size={13} />
          {label}
        </>
      )}
      <span className="sr-only" aria-live="polite">
        {done ? "Berhasil disalin" : ""}
      </span>
    </button>
  );
}
function Header({ onSearch, docs = false, onMenu }) {
  const headerLocation = useLocation(),
    motionEnabled = useMotionEnabled();
  return (
    <header className="site-header connection-header">
      <div className="header-frame">
        <Link href="/" className="brand" aria-label="JKT48Connect, beranda">
          <span className="brand-stamp">
            <Mark size={29} />
            <small>48</small>
          </span>
          <span>
            jkt48<span className="brand-connect">connect</span>
            <small>THE FAN DEVELOPER INTERFACE</small>
          </span>
        </Link>
        <nav aria-label="Navigasi utama">
          <Link href="/docs" className={docs ? "current" : ""}>
            <small>01</small>Dokumentasi
          </Link>
          <Link href="/docs/reference">
            <small>02</small>Reference
          </Link>
          <a href={GitHub} target="_blank" rel="noreferrer">
            <small>03</small>Source ↗
          </a>
        </nav>
        <div className="header-actions">
          <button
            className="motion-toggle"
            type="button"
            aria-pressed={motionEnabled}
            aria-label={motionEnabled ? "Matikan animasi" : "Aktifkan animasi"}
            title={
              motionEnabled
                ? "Animasi aktif. Klik untuk mematikan."
                : motion.getPreference() === "auto"
                  ? "Animasi mengikuti pengaturan perangkat. Klik untuk mengaktifkan."
                  : "Animasi mati. Klik untuk mengaktifkan."
            }
            onClick={() => motion.setEnabled(!motionEnabled)}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
              {motionEnabled ? (
                <>
                  <path
                    d="M5 4v8M11 4v8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </>
              ) : (
                <path d="m5 3 8 5-8 5Z" fill="currentColor" />
              )}
            </svg>
            <span>Animasi {motionEnabled ? "aktif" : "mati"}</span>
          </button>
          <button
            className="search-trigger"
            onClick={onSearch}
            aria-label="Cari dokumentasi"
          >
            <Icon name="search" size={16} />
            <span>Cari sesuatu</span>
            <kbd>⌘ K</kbd>
          </button>
          <button
            className="menu-trigger"
            onClick={onMenu}
            aria-label="Buka navigasi"
          >
            <Icon name="menu" />
          </button>
          <Link href="/docs/guide/mulai-menggunakan" className="header-start">
            Let's build <Icon size={15} />
          </Link>
        </div>
      </div>
      <div className="header-wire">
        <span>
          <i />
          PUBLIC API / OPEN DOCUMENTATION
        </span>
        <span className="header-ascii" aria-hidden="true">
          <AsciiFriend compact key={headerLocation.split("#")[0]} />{" "}
          <i>YOUR NEXT IDEA IS CONNECTED</i>
        </span>
        <span className="header-coordinate">JKT / UTC+07</span>
      </div>
      <div className="reading-progress" />
    </header>
  );
}
function SignalDiagram() {
  return (
    <div className="signal-diagram">
      <svg viewBox="0 0 1040 280" aria-hidden="true" className="signal-wires">
        <defs>
          <pattern
            id="micro-grid"
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r=".6" fill="#c4beb6" />
          </pattern>
        </defs>
        <rect
          x="389"
          y="27"
          width="262"
          height="224"
          rx="36"
          fill="url(#micro-grid)"
        />
        <g fill="none" stroke="#c5bfb6" strokeWidth="1">
          <path id="wire-0" d="M30 61H305Q335 61 354 88L440 140" />
          <path id="wire-1" d="M30 140H440" />
          <path id="wire-2" d="M30 219H305Q335 219 354 192L440 140" />
          <path id="wire-3" d="M600 140 686 88Q705 61 735 61H1010" />
          <path id="wire-4" d="M600 140H1010" />
          <path id="wire-5" d="M600 140 686 192Q705 219 735 219H1010" />
        </g>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <circle
            key={i}
            data-signal={i}
            r="3.5"
            fill={i % 2 ? "#171719" : "#e30b1c"}
          />
        ))}
        <g fill="#171719">
          {[
            [32, 61],
            [32, 140],
            [32, 219],
            [1008, 61],
            [1008, 140],
            [1008, 219],
          ].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="3" />
          ))}
        </g>
      </svg>
      <div className="signal-labels left">
        <Link href={routeHref({ method: "GET", path: "/api/news" })}>
          NEWS <span>01</span>
        </Link>
        <Link href={routeHref({ method: "GET", path: "/api/member" })}>
          MEMBERS <span>02</span>
        </Link>
        <Link href={routeHref({ method: "GET", path: "/api/theater" })}>
          THEATER <span>03</span>
        </Link>
      </div>
      <Link
        href="/docs"
        className="signal-core"
        aria-label="Jelajahi API JKT48Connect"
      >
        <div>
          <Mark size={66} />
        </div>
        <small>ONE CONNECTION</small>
      </Link>
      <div className="signal-labels right">
        <Link href={routeHref({ method: "GET", path: "/api/now_live" })}>
          <span>04</span> LIVE
        </Link>
        <Link href={routeHref({ method: "GET", path: "/api/recent" })}>
          <span>05</span> RECENT
        </Link>
        <Link href="/docs/guide/gambar-leaderboard-recent">
          <span>06</span> MEDIA
        </Link>
      </div>
      <span className="diagram-note">SUMBER DATA → API → IDE KAMU</span>
    </div>
  );
}
function EndpointMap({ catalog }) {
  const items = [
      ["News", "/api/news"],
      ["Member", "/api/member"],
      ["Theater", "/api/theater"],
      ["Live", "/api/idn"],
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
      .filter((x) => x.count),
    max = Math.max(...items.map((x) => x.count));
  return (
    <div className="endpoint-map">
      <div className="map-top">
        <span>PETA ENDPOINT</span>
        <small>Berdasarkan katalog yang tersedia</small>
      </div>
      <div className="map-columns">
        {items.map(({ group, count, q }) => (
          <Link
            key={group}
            href={
              "/docs/reference?" +
              (q === "media" ? "group=Media" : "q=" + encodeURIComponent(q))
            }
            className="map-column"
            aria-label={group + ", " + count + " route"}
          >
            <strong>{count}</strong>
            <div className="pixel-bar">
              {Array.from({ length: 12 }, (_, row) => (
                <div
                  key={row}
                  className={
                    row >= 12 - Math.max(1, Math.round((count / max) * 12))
                      ? "filled"
                      : ""
                  }
                >
                  {Array.from({ length: 4 }, (_, i) => (
                    <i key={i} />
                  ))}
                </div>
              ))}
            </div>
            <span>{group}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
function Landing({ catalog }) {
  const scope = useRef(),
    [wave, setWave] = useState(0),
    motionEnabled = useMotionEnabled();
  useEffect(() => {
    if (!motionEnabled) return;
    const context = gsap.context(() => {
      gsap.from(".hero-enter", {
        y: 22,
        opacity: 0,
        duration: 0.8,
        stagger: 0.09,
        ease: "power2.out",
        clearProps: "opacity,transform",
      });
      scope.current
        .querySelectorAll("[data-signal]")
        .forEach((dot, i) =>
          gsap.to(dot, {
            motionPath: {
              path: "#wire-" + i,
              align: "#wire-" + i,
              alignOrigin: [0.5, 0.5],
            },
            duration: 3.8 + i * 0.2,
            delay: i * 0.4,
            repeat: -1,
            ease: "none",
          }),
        );
      gsap.to(".scene-sticker", {
        y: -5,
        rotation: 3.5,
        duration: 2.8,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });
      gsap.utils
        .toArray(".reveal")
        .forEach((el) =>
          gsap.from(el, {
            y: 28,
            autoAlpha: 0.35,
            duration: 0.7,
            ease: "power2.out",
            scrollTrigger: { trigger: el, start: "top 94%", once: true },
            clearProps: "opacity,visibility,transform",
          }),
        );
    }, scope);
    let active = true;
    document.fonts.ready.then(() => {
      if (active) ScrollTrigger.refresh();
    });
    return () => {
      active = false;
      context.revert();
    };
  }, [motionEnabled]);
  return (
    <div className="landing" ref={scope}>
      <section className="hero workbench-hero">
        <div className="hero-copy">
          <div className="hero-index hero-enter">
            <span className="status-dot" /> A LITTLE CONNECTION. A LOT OF
            POSSIBILITIES.
          </div>
          <h1 className="hero-enter">
            Dari oshi.
            <br />
            Jadi <span>karyamu.</span>
            <svg
              className="hero-scribble"
              viewBox="0 0 260 18"
              aria-hidden="true"
            >
              <path
                d="M3 12Q100 0 250 8M70 15Q165 6 257 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </h1>
          <p className="hero-subtitle hero-enter">
            Berita, theater, live, dan cerita setelahnya.
            <br />
            Data JKT48 yang siap kamu bawa ke aplikasi,
            <br className="desktop-break" /> bot, atau ide kecil yang belum
            sempat jadi.
          </p>
          <div className="hero-actions hero-enter">
            <Link
              href="/docs/guide/mulai-menggunakan"
              className="primary-button"
            >
              <span className="button-pixel">↗</span>Mulai membangun
              <Icon size={16} />
            </Link>
            <Link href="/docs/reference" className="text-button">
              Jelajahi API <Icon size={15} />
            </Link>
          </div>
          <div className="hero-footnote hero-enter">
            <AsciiFriend />
            <span>
              <b>MADE FOR YOUR SIDE PROJECT.</b>
              <br />
              JSON, media, dan momen yang bisa disimpan.
            </span>
          </div>
        </div>
        <div className="workbench-scene hero-enter">
          <div className="scene-coordinate">
            FIG. 048 <span>THE CONNECTION DESK</span>
          </div>
          <div className="scene-grid" aria-hidden="true" />
          <div className="floating-request">
            <div className="window-label">
              <span>
                <i />
                <i />
                <i />
              </span>
              request.js <span>↗</span>
            </div>
            <div className="request-filetree">
              <span>jkt48 /</span>
              <b>└ app.js</b>
              <small>
                {" "}
                data
                <br /> components
                <br /> memories
              </small>
            </div>
            <pre>
              <span>const</span>
              {" response = "}
              <span>await</span>
              {" fetch(\n  "}
              <em>'/api/now_live'</em>
              {"\n);\n\n"}
              <span>const</span>
              {" { lives } =\n  "}
              <span>await</span>
              {" response.json();"}
            </pre>
            <div className="request-window-foot">
              GET <span>/api/now_live</span>
              <i>PUBLIC</i>
            </div>
          </div>
          <div className="scene-sticker">
            <span>HELLO, I'M PIP.</span>
            <strong>{wave ? "(^_^)/" : "( o.o )"}</strong>
            <small>
              {wave
                ? "Ada ide? Yuk, mulai dari docs."
                : "Klik aku. Aku bisa menyapa."}
            </small>
          </div>
          <Suspense
            fallback={
              <div className="character-stage">
                <div className="scene-loading">
                  <LittleBadge />
                </div>
              </div>
            }
          >
            <Character wave={wave} onWave={() => setWave((v) => v + 1)} />
          </Suspense>
          <div className="scene-quickstart">
            <span>YOUR FIRST CONNECTION</span>
            <code>curl api.jkt48connect.app/api/news</code>
            <Copy
              text="curl 'https://api.jkt48connect.app/api/news'"
              label="Salin"
            />
          </div>
          <span className="scene-caption">FOLLOW THE DATA. MAKE IT YOURS.</span>
        </div>
      </section>
      <div className="connection-strip">
        <span className="strip-label">
          <Mark size={20} />
          ONE API.
          <br />
          YOUR UNIVERSE.
        </span>
        {[
          ["NEWS", "/api/news"],
          ["MEMBERS", "/api/member"],
          ["THEATER", "/api/theater"],
          ["LIVE", "/api/now_live"],
          ["RECENT", "/api/recent"],
        ].map(([label, path], i) => (
          <Link key={label} href={routeHref({ method: "GET", path })}>
            <span>0{i + 1}</span>
            {label}
            <Icon size={15} />
          </Link>
        ))}
      </div>
      <section className="landing-intro reveal">
        <div className="section-index">01 / THE CONNECTION</div>
        <div className="intro-heading">
          <h2>
            Yang kamu ikuti.
            <br />
            <span>Yang bisa kamu buat.</span>
          </h2>
          <p>
            Website fanbase, bot komunitas, atau proyek pertamamu. Mulai dari
            data yang sudah terstruktur, lalu tentukan sendiri bentuknya.
          </p>
        </div>
        <div className="connection-grid">
          {[
            [
              "01",
              "Kabar & profil",
              "Berita, member, ulang tahun, dan jadwal theater.",
              "/api/member",
            ],
            [
              "02",
              "Saat live berlangsung",
              "Live Showroom dan IDN dalam satu referensi.",
              "/api/now_live",
            ],
            [
              "03",
              "Setelah layar padam",
              "Recent, gold per pengguna, screenshot, dan replay.",
              "/api/recent",
            ],
          ].map(([no, title, text, path]) => (
            <Link
              key={no}
              href={routeHref({ method: "GET", path })}
              className="connection-cell"
            >
              <span className="cell-number">[ {no} ]</span>
              <Icon
                name={no === "01" ? "book" : no === "02" ? "code" : "external"}
                size={30}
              />
              <h3>{title}</h3>
              <p>{text}</p>
              <span className="cell-link">
                Lihat endpoint <Icon size={16} />
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section className="build-section reveal">
        <div className="build-copy">
          <div className="section-index">02 / FIRST REQUEST</div>
          <h2>
            Satu request.
            <br />
            <span>Mulai dari sini.</span>
          </h2>
          <p>
            Berita dan profil member bisa diakses tanpa login. Contoh ini sudah
            cukup untuk memulai.
          </p>
          <Link className="text-button" href="/docs/guide/mulai-menggunakan">
            Buka quick start <Icon size={16} />
          </Link>
          <div className="tiny-mascot">
            <pre aria-hidden="true">{monoFace}</pre>
            <span>
              HELLO, BUILDER.
              <br />
              MAKE SOMETHING
              <br />
              FOR YOUR OSHI.
            </span>
          </div>
        </div>
        <div className="landing-code">
          <div className="code-toolbar">
            <span>
              <i /> request.js
            </span>
            <Copy
              text={
                "const response = await fetch('https://api.jkt48connect.app/api/news');\nconst { news } = await response.json();\nconsole.log(news);"
              }
            />
          </div>
          <pre>
            <code>
              <span className="token-muted">
                {"// kabar terbaru, langsung ke aplikasimu\n"}
              </span>
              <span className="token-red">const</span>
              {" response = "}
              <span className="token-red">await</span>
              {" fetch(\n  "}
              <span className="token-string">
                {"'https://api.jkt48connect.app/api/news'"}
              </span>
              {"\n);\n\n"}
              <span className="token-red">const</span>
              {" { news } = "}
              <span className="token-red">await</span>
              {" response.json();\nconsole.log(news);"}
            </code>
          </pre>
          <div className="response-preview">
            <span>RESPONSE SHAPE</span>
            <pre>
              {
                '{\n  "news": [ ... ],\n  "page": 1,\n  "perpage": 10,\n  "total_count": ...\n}'
              }
            </pre>
            <small>
              Bentuk respons ringkas. Contoh output lengkap ada di referensi.
            </small>
          </div>
        </div>
      </section>
      <section className="coverage-section reveal">
        <div className="section-index">03 / FIND YOUR ROUTE</div>
        <div className="intro-heading">
          <h2>
            Ada jalan untuk
            <br />
            <span>setiap ide.</span>
          </h2>
          <p>
            Telusuri katalog berdasarkan jenis data dan akses yang dibutuhkan.
            Setiap route punya parameter, autentikasi, serta contoh pemanggilan.
          </p>
        </div>
        <EndpointMap catalog={catalog} />
      </section>
      <section className="signal-section reveal">
        <div>
          <div className="section-index">04 / ALL CONNECTED</div>
          <h2>
            Dari satu sumber,
            <br />
            <span>ke banyak kemungkinan.</span>
          </h2>
          <p>
            Temukan bentuk data yang tepat, periksa aksesnya, lalu sambungkan ke
            proyekmu.
          </p>
        </div>
        <SignalDiagram />
      </section>
      <section className="bottom-cta reveal">
        <div>
          <span className="section-index">YOUR NEXT COMMIT STARTS HERE</span>
          <h2>
            Ikuti datanya.
            <br />
            Buat <em>sesuatu.</em>
          </h2>
        </div>
        <div className="cta-right">
          <pre aria-hidden="true">
            {
              "  +---------+\n  |  >_ 48  |\n  +----+----+\n       |\n    [ READY ]"
            }
          </pre>
          <Link className="primary-button" href="/docs">
            <span className="button-pixel">+</span>Buka dokumentasi
            <Icon size={16} />
          </Link>
        </div>
      </section>
      <Footer />
    </div>
  );
}
function Footer({ reader = false } = {}) {
  if (reader)
    return (
      <footer className="reader-colophon">
        <AsciiFriend compact />
        <span>JKT48Connect / notes for your next idea.</span>
        <a href="/docs/guide.md" download>
          Catatan .md ↓
        </a>
      </footer>
    );
  return (
    <footer className="connection-footer">
      <div className="footer-main">
        <div className="footer-note">
          <span className="footer-eyebrow">
            A SMALL CORNER OF THE FAN INTERNET
          </span>
          <Link href="/" className="footer-wordmark">
            <Mark size={35} />
            <span>jkt48connect</span>
            <small>© {new Date().getFullYear()}</small>
          </Link>
          <p>
            Dari yang kita ikuti,
            <br />
            untuk hal yang ingin kita buat.
          </p>
          <span className="footer-byline">
            INDEPENDENT FAN PROJECT · CRAFTED BY VALZY
          </span>
        </div>
        <nav className="footer-index" aria-label="Tautan footer">
          <Link href="/docs">
            <span>01 / READ</span>
            <strong>Dokumentasi</strong>
            <Icon size={19} />
          </Link>
          <Link href="/docs/reference">
            <span>02 / EXPLORE</span>
            <strong>API reference</strong>
            <Icon size={19} />
          </Link>
          <a href={GitHub} target="_blank" rel="noreferrer">
            <span>03 / CONTRIBUTE</span>
            <strong>Source di GitHub</strong>
            <Icon name="external" size={17} />
          </a>
        </nav>
        <div className="footer-postcard">
          <AsciiFriend />
          <span className="postcard-greeting">
            SEE YOU IN
            <br />
            YOUR NEXT COMMIT.
          </span>
          <a href="/docs/guide.md" download>
            Take the notes with you <span>↓ .md</span>
          </a>
        </div>
      </div>
      <div className="footer-tear">
        <span>JKT48CONNECT / PUBLIC INTERFACE</span>
        <span className="footer-dotline" />
        <span>MADE FOR FANS. WITH A LITTLE EXTRA CARE.</span>
      </div>
      <div className="footer-colophon">
        <span>Tidak berafiliasi dengan manajemen JKT48.</span>
        <button
          onClick={() =>
            window.scrollTo({
              top: 0,
              behavior: motion.getSnapshot() ? "smooth" : "instant",
            })
          }
        >
          Kembali ke atas <span>↑</span>
        </button>
        <span className="footer-terminal" aria-hidden="true">
          &lt; / &gt; &nbsp; END OF TRANSMISSION_
        </span>
      </div>
    </footer>
  );
}
function Sidebar({ catalog, guides, current, onNavigate }) {
  const [filter, setFilter] = useState("");
  return (
    <>
      <div className="sidebar-top">
        <span>WORKSPACE</span>
        <Link href="/docs" className="workspace">
          <Mark size={22} />
          <div>
            JKT48Connect<small>Developer documentation</small>
          </div>
          <span className="workspace-dot" />
        </Link>
      </div>
      <div className="sidebar-links">
        <Link
          onClick={onNavigate}
          className={current === "/docs" ? "selected" : ""}
          href="/docs"
        >
          <Icon name="book" size={15} />
          Overview
        </Link>
        <Link
          onClick={onNavigate}
          className={current.startsWith("/docs/reference") ? "selected" : ""}
          href="/docs/reference"
        >
          <Icon name="code" size={15} />
          API Reference <small>{catalog.routes.length}</small>
        </Link>
        <Link
          onClick={onNavigate}
          className={current.endsWith("/markdown") ? "selected" : ""}
          href="/docs/guide/markdown"
        >
          <span className="markdown-symbol">M↓</span>Markdown lab
        </Link>
      </div>
      <label className="sidebar-filter">
        <Icon name="search" size={14} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter panduan…"
          aria-label="Filter navigasi panduan"
        />
      </label>
      <div className="sidebar-section-label">PANDUAN & INTEGRASI</div>
      <nav aria-label="Panduan dokumentasi" className="guide-nav">
        {guides
          .filter(
            (g) =>
              g.slug !== "markdown" &&
              g.title.toLowerCase().includes(filter.toLowerCase()),
          )
          .map((g) => (
            <Link
              onClick={onNavigate}
              key={g.slug}
              href={"/docs/guide/" + g.slug}
              className={current === "/docs/guide/" + g.slug ? "selected" : ""}
            >
              {g.title}
            </Link>
          ))}
      </nav>
      <div className="sidebar-bottom">
        <span className="status-dot" /> PUBLIC DOCUMENTATION
        <small>{catalog.version} · valzy</small>
      </div>
    </>
  );
}
function Overview({ catalog, guides }) {
  return (
    <>
      <div className="page-kicker">DOCUMENTATION / OVERVIEW</div>
      <h1>
        Buka catatannya.
        <br />
        <span>Bangun idemu.</span>
      </h1>
      <p className="article-lead">
        Kenali API, temukan endpoint, lalu hubungkan ke aplikasimu. Semua
        panduan dan referensi tersedia di sini.
      </p>
      <div className="overview-feature">
        <div>
          <span className="section-index">FIRST THINGS FIRST</span>
          <h2>
            Request pertama
            <br />
            dalam beberapa baris.
          </h2>
          <p>
            News dan member bisa diakses tanpa API key. Untuk recent dan
            integrasi server, baca kebutuhan autentikasinya.
          </p>
          <Link href="/docs/guide/mulai-menggunakan" className="text-button">
            Ikuti quick start <Icon size={15} />
          </Link>
        </div>
        <div className="overview-terminal">
          <span>TERMINAL</span>
          <pre>
            {"curl 'https://api.jkt48connect.app/api/news?page=1&perpage=10'"}
          </pre>
          <small>Endpoint publik · tanpa API key.</small>
        </div>
      </div>
      <h2 id="pilih-jalur">Pilih jalurmu.</h2>
      <div className="guide-tiles">
        {[
          [
            "API reference",
            catalog.routes.length +
              " kombinasi method dan route. Parameter serta contoh output.",
            "/docs/reference",
            "code",
          ],
          [
            "Autentikasi",
            "Akses publik dan API key untuk aplikasi.",
            "/docs/guide/autentikasi-dan-integrasi",
            "book",
          ],
          [
            "Live & recent",
            "Rekap sesi, gold, screenshot, dan rekaman.",
            "/docs/guide/live-dan-recent",
            "external",
          ],
          [
            "Markdown lab",
            "Tabel, syntax highlight, Mermaid, matematika, dan catatan kaki.",
            "/docs/guide/markdown",
            "book",
          ],
        ].map(([title, text, href, icon]) => (
          <Link href={href} key={title} className="guide-tile">
            <Icon name={icon} size={22} />
            <h3>{title}</h3>
            <p>{text}</p>
            <Icon className="tile-arrow" size={16} />
          </Link>
        ))}
      </div>
      <h2 id="sebelum-memulai">Sebelum memulai</h2>
      <div className="callout">
        <strong>Kenali bentuk responsnya.</strong>
        <p>
          Respons mengikuti endpoint: JSON, teks, gambar, atau playlist. Tidak
          ada satu envelope sukses yang dipakai semua route. Cek contoh di
          referensi sebelum melakukan parsing.
        </p>
      </div>
      <div className="overview-facts">
        <div>
          <span>BASE URL</span>
          <code>https://api.jkt48connect.app</code>
          <Copy text="https://api.jkt48connect.app" />
        </div>
        <div>
          <span>FORMAT & WAKTU</span>
          <p>
            JSON · UTC pada timestamp ISO
            <br />
            Tampilkan WIB dengan <code>Asia/Jakarta</code>.
          </p>
        </div>
      </div>
      <h2 id="semua-panduan">Semua panduan</h2>
      <div className="all-guides">
        {guides
          .filter((g) => g.slug !== "markdown")
          .map((g, i) => (
            <Link key={g.slug} href={"/docs/guide/" + g.slug}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              {g.title}
              <Icon size={15} />
            </Link>
          ))}
      </div>
    </>
  );
}
function CodeExample({ code, language }) {
  return (
    <div className="code-block">
      <div className="code-toolbar">
        <span className="code-file-label">{language}</span>
        <Copy text={code} />
      </div>
      <pre tabIndex={0}>
        <code>{code}</code>
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
    pathNames = [...route.path.matchAll(/:([a-z_]+)/g)].map((m) => m[1]);
  const sample = route.response?.body ?? route.successExample;
  async function run() {
    if (!canTry(route)) return;
    setBusy(true);
    setOutput(null);
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
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
      <div className="page-kicker">
        API REFERENCE / {route.group.toUpperCase()}
      </div>
      <div className="endpoint-title">
        <span className={"method " + route.method}>{route.method}</span>
        <h1>{route.path}</h1>
      </div>
      <div className="endpoint-meta">
        <span>
          <i
            className={route.auth === "Publik" ? "public-dot" : "private-dot"}
          />
          {route.auth}
        </span>
        <span>{route.contentType || "Respons mengikuti endpoint"}</span>
      </div>
      <Suspense fallback={<p>Memuat deskripsi…</p>}>
        <MarkdownContent source={route.description} />
      </Suspense>
      <div className="route-source">
        <a href={route.source} target="_blank" rel="noreferrer">
          Lihat implementasi <Icon name="external" size={13} />
        </a>
      </div>
      <h2 id="parameters">Parameter</h2>
      {Object.keys(values).length ? (
        <div className="table-scroll">
          <table className="param-table">
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Lokasi</th>
                <th>Contoh nilai</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(values).map(([name, value]) => (
                <tr key={name}>
                  <td>
                    <code>{name}</code>
                  </td>
                  <td>
                    <span className="location-tag">
                      {pathNames.includes(name) ? "path" : "query"}
                    </span>
                  </td>
                  <td>
                    <input
                      aria-label={"Parameter " + name}
                      value={value}
                      onChange={(e) =>
                        setValues({ ...values, [name]: e.target.value })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">
          Contoh dasar tidak memerlukan parameter tambahan.
        </p>
      )}
      {route.body && (
        <>
          <h2 id="request-body">Request body</h2>
          <CodeExample
            code={JSON.stringify(route.body, null, 2)}
            language={route.contentType}
          />
        </>
      )}
      <h2 id="request-example">Contoh request</h2>
      <div className="code-tabs" role="tablist" aria-label="Bahasa contoh">
        {["curl", "javascript", "python"].map((lang) => (
          <button
            key={lang}
            role="tab"
            aria-selected={language === lang}
            onClick={() => setLanguage(lang)}
          >
            {lang === "curl"
              ? "cURL"
              : lang === "javascript"
                ? "JavaScript"
                : "Python"}
          </button>
        ))}
      </div>
      <CodeExample code={code} language={language} />
      {!canTry(route) && (
        <p className="code-caption">
          Contoh memakai placeholder. Endpoint ini tidak dijalankan dari halaman
          docs.
        </p>
      )}
      <div className="response-head">
        <h2 id="response">Respons</h2>
        {canTry(route) && (
          <button className="run-button" disabled={busy} onClick={run}>
            {busy ? "Memuat…" : "Coba GET"}
            <Icon size={14} />
          </button>
        )}
      </div>
      <div className="response-label">
        <span
          className={"response-status " + (output && !output.ok ? "error" : "")}
        >
          {output
            ? "HTTP " + (output.status || "—")
            : route.response
              ? "HTTP " + route.response.status
              : "CONTOH SOURCE"}
        </span>
        <span>
          {output
            ? "Hasil request langsung"
            : route.responseLabel || "Contoh berdasarkan source"}
        </span>
      </div>
      <CodeExample
        code={
          output?.body ??
          (sample === undefined
            ? "Contoh output belum tersedia untuk route ini. Lihat implementasi dan panduan autentikasi."
            : JSON.stringify(shortResponse(sample), null, 2))
        }
        language="response"
      />
      <p className="code-caption">
        Array contoh ditampilkan maksimal dua item.{" "}
        <a href="/docs/responses.json" download>
          Unduh arsip output lengkap ↓
        </a>
      </p>
      {route.successExample && route.response && (
        <details className="extra-example">
          <summary>Contoh sukses dari source</summary>
          <CodeExample
            code={JSON.stringify(route.successExample, null, 2)}
            language="json"
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
      <div className="page-kicker">REFERENCE / ROUTE EXPLORER</div>
      <h1>
        Temukan
        <br />
        <span>jalur datamu.</span>
      </h1>
      <p className="article-lead">
        {catalog.routes.length} kombinasi method dan route, dari data publik
        sampai integrasi server. Periksa label akses pada setiap endpoint.
      </p>
      <div className="reference-filters">
        <label>
          <Icon name="search" size={16} />
          <input
            aria-label="Cari endpoint"
            placeholder="Cari endpoint atau fungsi…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter method"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          <option value="">Semua method</option>
          {["GET", "HEAD", "POST", "PUT", "DELETE"].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select
          aria-label="Filter grup"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
        >
          <option value="">Semua grup</option>
          {groups.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </div>
      <div className="result-count">{routes.length} ROUTE DITEMUKAN</div>
      <div className="route-list">
        {routes.map((r) => (
          <Link href={routeHref(r)} key={routeKey(r)} className="route-item">
            <span className={"method " + r.method}>{r.method}</span>
            <div>
              <code>{r.path}</code>
              <p>{r.description.replace(/`/g, "").slice(0, 140)}</p>
            </div>
            <span className="auth-tag">{r.auth}</span>
            <Icon size={15} />
          </Link>
        ))}
      </div>
      {!routes.length && (
        <div className="empty-state">
          <pre>{"( . _ . )"}</pre>
          <h2>Belum ketemu.</h2>
          <p>Coba kata kunci lain atau hapus filter.</p>
          <button
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
  const [headings, set] = useState([]);
  useEffect(() => {
    const update = () =>
      set(
        [...(article.current?.querySelectorAll("h2[id],h3[id]") || [])].map(
          (h) => ({ id: h.id, text: h.textContent, level: h.tagName }),
        ),
      );
    update();
    const observer = new MutationObserver(update);
    if (article.current)
      observer.observe(article.current, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [page]);
  return (
    <div className="toc-inner">
      <span>DI HALAMAN INI</span>
      <nav aria-label="Daftar isi halaman">
        {headings.slice(0, 40).map((h) => (
          <a
            key={h.id}
            href={"#" + h.id}
            className={h.level === "H3" ? "nested" : ""}
          >
            {h.text}
          </a>
        ))}
      </nav>
      <div className="toc-help">
        <span>ADA YANG KURANG?</span>
        <a href={GitHub + "/issues"} target="_blank" rel="noreferrer">
          Buka issue <Icon name="external" size={12} />
        </a>
        <a href="/docs/guide.md" download>
          Unduh Markdown ↓
        </a>
      </div>
    </div>
  );
}
function Guide({ page, guides }) {
  const [edit, setEdit] = useState(false),
    [source, setSource] = useState(page.content),
    index = guides.findIndex((g) => g.slug === page.slug);
  return (
    <>
      <div className="reader-toolbar">
        <span>
          <LittleBadge />
          FIELD NOTES / GUIDE
        </span>
        <span>
          {Math.max(1, Math.ceil(page.content.split(/\s+/).length / 220))} MIN
          READ <i>·</i> PUBLIC
        </span>
      </div>
      <div className="page-kicker">
        GUIDE / {String(index + 1).padStart(2, "0")}
      </div>
      <h1>{page.title}</h1>
      {page.slug === "markdown" && (
        <div className="markdown-lab-controls">
          <button className="run-button" onClick={() => setEdit(!edit)}>
            {edit ? "Tutup editor" : "Coba Markdown sendiri"}
            <Icon name="code" size={14} />
          </button>
          {edit && (
            <button onClick={() => setSource(page.content)}>
              Reset contoh
            </button>
          )}
        </div>
      )}
      {edit && (
        <label className="markdown-editor">
          MARKDOWN SOURCE
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
      <div className="page-pagination">
        {index > 0 ? (
          <Link href={"/docs/guide/" + guides[index - 1].slug}>
            <small>← SEBELUMNYA</small>
            {guides[index - 1].title}
          </Link>
        ) : (
          <span />
        )}
        {index < guides.length - 1 && (
          <Link href={"/docs/guide/" + guides[index + 1].slug}>
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
    [query, setQuery] = useState("");
  useEffect(() => {
    if (open) {
      ref.current.showModal();
      input.current?.focus();
    } else ref.current?.close();
  }, [open]);
  const needle = query.trim().toLowerCase(),
    pages = guides
      .filter((g) => (g.title + " " + g.content).toLowerCase().includes(needle))
      .slice(0, 5),
    routes = catalog.routes
      .filter((r) =>
        (r.path + " " + r.description + " " + r.auth)
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, 8);
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
      <div className="search-dialog-input">
        <Icon name="search" />
        <input
          ref={input}
          aria-label="Pencarian dokumentasi"
          placeholder="Cari endpoint, panduan, atau topik…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button onClick={onClose} aria-label="Tutup pencarian">
          <kbd>ESC</kbd>
        </button>
      </div>
      <div className="search-results">
        {!needle && (
          <p className="search-hint">
            Mulai dari{" "}
            <button onClick={() => setQuery("recent")}>recent</button>,{" "}
            <button onClick={() => setQuery("member")}>member</button>, atau{" "}
            <button onClick={() => setQuery("gold")}>gold</button>.
          </p>
        )}
        {pages.length > 0 && <span className="search-category">PANDUAN</span>}
        {pages.map((g) => (
          <Link key={g.slug} href={"/docs/guide/" + g.slug} onClick={onClose}>
            <Icon name="book" size={16} />
            <span>
              {g.title}
              <small>{g.content.replace(/[#*`\n]/g, " ").slice(0, 105)}…</small>
            </span>
            <Icon size={14} />
          </Link>
        ))}
        {routes.length > 0 && <span className="search-category">ENDPOINT</span>}
        {routes.map((r) => (
          <Link key={routeKey(r)} href={routeHref(r)} onClick={onClose}>
            <span className={"method " + r.method}>{r.method}</span>
            <span>
              {r.path}
              <small>
                {r.group} · {r.auth}
              </small>
            </span>
            <Icon size={14} />
          </Link>
        ))}
        {!pages.length && !routes.length && (
          <p className="search-hint">Tidak ditemukan hasil untuk “{query}”.</p>
        )}
      </div>
      <div className="search-dialog-footer">
        <span>Tab untuk berpindah · Enter untuk membuka</span>
        <span>JKT48Connect Docs</span>
      </div>
    </dialog>
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
  useEffect(() => {
    if (!motionEnabled) return;
    const target = document.querySelector("#main-content");
    const animation =
      target &&
      gsap.fromTo(
        target,
        { opacity: 0.45, y: 10 },
        {
          opacity: 1,
          y: 0,
          duration: 0.42,
          ease: "power2.out",
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
        docs={docs}
        onSearch={() => setSearch(true)}
        onMenu={() => mobile.current.showModal()}
      />
      {docs ? (
        <div className="docs-layout">
          <aside className="docs-sidebar">
            <Sidebar catalog={catalog} guides={guides} current={url.pathname} />
          </aside>
          <main
            id="main-content"
            className="docs-content"
            ref={article}
            key={url.pathname + url.search}
          >
            {notFound ? (
              <>
                <div className="page-kicker">404 / NOT FOUND</div>
                <h1>
                  Jalur ini
                  <br />
                  belum ada.
                </h1>
                <p>
                  Temukan halaman lain melalui pencarian atau kembali ke
                  dokumentasi.
                </p>
                <Link href="/docs" className="primary-button">
                  Kembali ke docs <Icon size={15} />
                </Link>
              </>
            ) : guide ? (
              <Guide page={guide} guides={guides} key={guide.slug} />
            ) : url.pathname === "/docs/reference" ? (
              <Reference catalog={catalog} search={url.search} />
            ) : (
              <Overview catalog={catalog} guides={guides} />
            )}
            <Footer reader />
          </main>
          <aside className="docs-toc">
            <Toc article={article} page={current} />
          </aside>
        </div>
      ) : (
        <main id="main-content">
          <Landing catalog={catalog} />
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
      >
        <button
          className="mobile-close"
          onClick={() => mobile.current.close()}
          aria-label="Tutup navigasi"
        >
          <Icon name="close" />
        </button>
        <Sidebar
          catalog={catalog}
          guides={guides}
          current={url.pathname}
          onNavigate={() => mobile.current.close()}
        />
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
        <button onClick={() => location.reload()}>Muat ulang</button>
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
        <button onClick={() => location.reload()}>Coba lagi</button>
      </div>,
    ),
  );

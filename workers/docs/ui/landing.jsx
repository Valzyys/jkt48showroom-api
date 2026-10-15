import React, { useEffect, useRef, useState } from "react";
import { useMotionEnabled } from "./motion.js";
import { AsciiScene } from "./ascii-scene.jsx";
import { AsciiFriend } from "./personality.jsx";
import { Mark, PixelIcon } from "./icons.jsx";
import {
  gsap,
  ScrollTrigger,
  SplitText,
  BASE,
  SITE,
  Icon,
  Link,
  Copy,
  tint,
  useReveal,
  LanguageTabs,
  motion,
} from "./shared.jsx";
import { routeHref, initialParams, requestCode } from "./request.js";

function SectionHead({ index, label, title, muted, text }) {
  return (
    <div className="section-head">
      <div>
        <span className="eyebrow">
          <i />
          <span data-scramble>{`${index} / ${label}`}</span>
        </span>
        <h2 data-split>
          {title} {muted && <span className="soft">{muted}</span>}
        </h2>
      </div>
      {text && <p className="rv">{text}</p>}
    </div>
  );
}

export function Landing({ catalog, guides }) {
  const scope = useRef(),
    motionEnabled = useMotionEnabled(),
    newsRoute = catalog.routes.find(
      (r) => r.method === "GET" && r.path === "/api/news",
    ) || { method: "GET", path: "/api/news", auth: "Publik", query: {} },
    [lang, setLang] = useState("javascript");
  useReveal(scope);
  useEffect(() => {
    if (!motionEnabled) return;
    const splits = [];
    const context = gsap.context(() => {
      const chars = gsap.utils.toArray("[data-hero-chars]").flatMap((el) => {
        const split = SplitText.create(el, { type: "chars" });
        splits.push(split);
        return split.chars;
      });
      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
      tl.from(chars, {
        yPercent: 120,
        rotate: 10,
        duration: 1.15,
        stagger: 0.028,
      })
        .to(
          ".hero-pixel",
          {
            duration: 1.1,
            scrambleText: {
              text: "karyamu.",
              chars: "▓▒░#*+=-.",
              speed: 0.45,
            },
          },
          "-=0.9",
        )
        .from(
          ".hero-fade",
          {
            y: 22,
            autoAlpha: 0,
            duration: 0.9,
            stagger: 0.08,
            clearProps: "transform,opacity,visibility",
          },
          "-=0.95",
        )
        .fromTo(
          ".hero-screen",
          { clipPath: "inset(10% 8% 10% 8% round 40px)", autoAlpha: 0 },
          {
            clipPath: "inset(0% 0% 0% 0% round 22px)",
            autoAlpha: 1,
            duration: 1.3,
            ease: "expo.inOut",
            clearProps: "clipPath,opacity,visibility",
          },
          0.15,
        )
        .from(
          ".hero-stat",
          {
            y: 30,
            autoAlpha: 0,
            duration: 0.9,
            stagger: 0.07,
            clearProps: "transform,opacity,visibility",
          },
          "-=0.8",
        );
      // Marquee speeds up with scroll velocity and follows scroll direction.
      const loop = gsap.to(".ticker-track", {
        xPercent: -50,
        duration: 38,
        ease: "none",
        repeat: -1,
      });
      ScrollTrigger.create({
        onUpdate(self) {
          const v = self.getVelocity();
          gsap.to(loop, {
            timeScale:
              (self.direction || 1) * (1 + Math.min(5, Math.abs(v) / 350)),
            duration: 0.25,
            overwrite: true,
            onComplete: () =>
              gsap.to(loop, {
                timeScale: self.direction || 1,
                duration: 1.2,
                ease: "power2.out",
              }),
          });
        },
      });
      // Data packets travel along the flow wires.
      const mm = gsap.matchMedia();
      mm.add(
        { wide: "(min-width: 1081px)", narrow: "(max-width: 1080px)" },
        ({ conditions }) => {
          gsap.utils.toArray(".wire-packet").forEach((el, i) =>
            gsap.fromTo(el, conditions.wide ? { left: "0%" } : { top: "0%" }, {
              ...(conditions.wide
                ? { left: "calc(100% - 8px)" }
                : { top: "calc(100% - 8px)" }),
              duration: 1.6,
              ease: "power2.inOut",
              repeat: -1,
              repeatDelay: 0.5,
              delay: i * 0.9,
            }),
          );
        },
      );
    }, scope);
    return () => {
      context.revert();
      splits.forEach((s) => s.revert());
    };
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
    ["NEWS", "/api/news", "news"],
    ["MEMBER", "/api/member", "info"],
    ["THEATER", "/api/theater", "calendar"],
    ["NOW LIVE", "/api/now_live", "live"],
    ["RECENT", "/api/recent", "replay"],
    ["SCREENSHOT", "/api/screenshots/:id", "camera"],
    ["LEADERBOARD", "/api/leaderboard", "bars"],
  ];
  const guideCount = guides.filter((g) => g.slug !== "markdown").length;
  return (
    <div className="landing" ref={scope}>
      <section className="hero-card" data-ascii-stage>
        <div className="hero-copy">
          <span className="chip hero-fade">
            <b>API</b>
            <span>PUBLIK · v{catalog.version}</span>
          </span>
          <h1 className="hero-title">
            <span className="hero-line">
              <span data-hero-chars>Dari oshi.</span>
            </span>
            <span className="hero-line">
              <span data-hero-chars>Jadi</span>{" "}
              <em className="hero-pixel">karyamu.</em>
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
              className="btn btn-ink btn-lg"
              data-magnetic
              data-pip="hero-start"
            >
              Mulai membangun <Icon size={16} />
            </Link>
            <Link
              href="/docs/reference"
              className="btn btn-soft btn-lg"
              data-magnetic
            >
              <PixelIcon name="code" size={14} /> Lihat API
            </Link>
          </div>
          <div className="terminal-line hero-fade" data-pip="hero-terminal">
            <span className="prompt">$</span>
            <code>curl -H "X-API-Key: $KEY" …/api/news</code>
            <i className="caret" aria-hidden="true" />
            <Copy
              text={
                "curl '" +
                BASE +
                '/api/news\' -H "X-API-Key: $JKT48CONNECT_API_KEY"'
              }
            />
          </div>
        </div>
        <div className="hero-screen">
          <div className="screen-meta">
            <span className="tag-soft">
              <i className="live-dot" /> FIG. 048
            </span>
            <span>LAT −6.20 · LON 106.82</span>
          </div>
          <AsciiScene
            shape="globe"
            size={11}
            speed={0.28}
            yaw={0.1}
            pitch={0.38}
            zoom={1.3}
            interactive
            className="hero-ascii"
          />
          <div className="screen-meta bottom">
            <span>ASCII · FLAT LIGHT · 0 SHADOW</span>
            <span className="screen-hint">GESER KURSOR · KLIK UNTUK PUTAR</span>
          </div>
        </div>
      </section>

      <div className="hero-stats">
        {[
          [catalog.routes.length, "endpoint publik", "code"],
          [guideCount, "panduan lengkap", "book"],
          [0, "API key untuk mulai", "key"],
          [counts.length, "kategori data", "bars"],
        ].map(([value, label, icon]) => (
          <div className="hero-stat" key={label}>
            <PixelIcon name={icon} size={16} />
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="ticker" aria-label="Kategori endpoint">
        <div className="ticker-track">
          {[0, 1].map((copy) => (
            <div className="ticker-row" key={copy} aria-hidden={copy === 1}>
              {strip.map(([label, path, icon]) => {
                const route = catalog.routes.find(
                  (r) => r.method === "GET" && r.path === path,
                );
                return (
                  <Link
                    key={label}
                    tabIndex={copy ? -1 : undefined}
                    href={route ? routeHref(route) : "/docs/reference"}
                  >
                    <PixelIcon name={icon} size={14} />
                    {label}
                    <small>{path}</small>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <section className="block">
        <SectionHead
          index="01"
          label="APA YANG BISA DIBUAT"
          title="Dibangun untuk proyek fans"
          muted="yang ingin tumbuh."
          text="Website fanbase, bot komunitas, atau proyek pertamamu. Mulai dari data yang sudah terstruktur, lalu tentukan sendiri bentuknya."
        />
        <div className="feature-grid" data-pip="landing-features">
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
            >
              <span className="feature-art">
                <span className="tag-soft">{tag}</span>
                <AsciiScene
                  shape={shape}
                  size={8}
                  speed={0.42 + i * 0.07}
                  yaw={i}
                  pitch={0.5}
                  zoom={shape === "cross" ? 0.98 : 1.12}
                  className="feature-ascii"
                />
              </span>
              <span className="feature-body">
                <h3>{title}</h3>
                <p>{text}</p>
                <span className="card-link">
                  <code>GET {path}</code>
                  <span className="round-arrow">
                    <Icon size={15} />
                  </span>
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="block request-grid">
        <div className="request-copy">
          <SectionHead
            index="02"
            label="REQUEST PERTAMA"
            title="Satu request."
            muted="Mulai dari sini."
          />
          <ol className="steps">
            {[
              ["Pilih endpoint", "Cari di reference atau tekan ⌘K.", "search"],
              [
                "Kirim request",
                "Buat API key gratis, kirim lewat header X-API-Key.",
                "play",
              ],
              ["Bangun idemu", "Tampilkan, simpan, atau olah datanya.", "home"],
            ].map(([title, text, icon], i) => (
              <li key={title} className="rv">
                <span className="step-icon">
                  <PixelIcon name={icon} size={16} />
                </span>
                <div>
                  <strong>
                    <small>0{i + 1}</small> {title}
                  </strong>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ol>
          <Link
            className="btn btn-soft"
            href="/docs/guide/mulai-menggunakan"
            data-magnetic
          >
            Buka quick start <Icon size={15} />
          </Link>
        </div>
        <div className="code-window rv" data-pip="landing-request">
          <div className="window-bar">
            <span className="dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <LanguageTabs
              value={lang}
              onChange={setLang}
              options={[
                ["javascript", "JavaScript"],
                ["python", "Python"],
                ["curl", "cURL"],
              ]}
            />
            <Copy text={code} />
          </div>
          <pre className="code-body" tabIndex={0}>
            <code>{tint(code)}</code>
          </pre>
          <div className="window-response">
            <div className="response-bar">
              <span className="status-pill ok">200 OK</span>
              <span>application/json · 128 ms</span>
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

      <section className="block">
        <SectionHead
          index="03"
          label="PETA ENDPOINT"
          title="Ada jalan"
          muted="untuk setiap ide."
          text="Telusuri katalog berdasarkan jenis data. Setiap route punya parameter, label akses, dan contoh pemanggilan."
        />
        <div className="chart-card rv" role="list" data-pip="landing-map">
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
                <span className="round-arrow small">
                  <Icon size={13} />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="block">
        <SectionHead
          index="04"
          label="SEMUA TERHUBUNG"
          title="Dari satu sumber,"
          muted="ke banyak kemungkinan."
        />
        <div className="flow-diagram rv">
          {[
            ["SUMBER", ["SHOWROOM", "IDN LIVE", "JKT48.COM"], "live"],
            ["JKT48CONNECT", ["NORMALISASI", "CACHE", "MEDIA R2"], "code"],
            ["PROYEKMU", ["WEBSITE", "BOT", "DASHBOARD"], "home"],
          ].map(([title, items, icon], i) => (
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
                <span className="node-top">
                  <PixelIcon name={icon} size={16} />
                  <span>0{i + 1}</span>
                </span>
                <strong>{title}</strong>
                <ul>
                  {items.map((x) => (
                    <li key={x}>
                      <span aria-hidden="true">├─ </span>
                      {x}
                    </li>
                  ))}
                </ul>
              </div>
            </React.Fragment>
          ))}
        </div>
      </section>

      <FanbaseRoll />

      <section className="cta-card rv-clip" data-ascii-stage>
        <div className="cta-copy">
          <span className="eyebrow light">
            <i />
            <span data-scramble>YOUR NEXT COMMIT STARTS HERE</span>
          </span>
          <h2 data-split>
            Ikuti datanya. <span className="soft">Buat sesuatu.</span>
          </h2>
          <div className="hero-actions">
            <Link className="btn btn-accent btn-lg" href="/docs" data-magnetic>
              Buka dokumentasi <Icon size={16} />
            </Link>
            <a
              className="btn btn-ghost btn-lg"
              href={SITE}
              target="_blank"
              rel="noreferrer"
              data-magnetic
            >
              <Icon name="globe" size={15} /> jkt48connect.com
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

// Fanbases approved in the program that agreed to be listed. Loaded from the
// public roll; with none yet, the block stays an invitation.
function FanbaseRoll() {
  const [list, setList] = useState(null);
  useEffect(() => {
    fetch("/dashboard/api/fanbases")
      .then((r) => (r.ok ? r.json() : { fanbases: [] }))
      .then((d) => setList(d.fanbases || []))
      .catch(() => setList([]));
  }, []);
  const names = list || [];
  return (
    <section className="block fanbase-roll" aria-labelledby="fanbase-roll">
      <SectionHead
        index="05"
        label="DIBANGUN BERSAMA FANBASE"
        title="Dibangun bersama"
        muted="fanbase JKT48."
      />
      {names.length > 0 && (
        <div className="fanbase-track" aria-label="Fanbase terdaftar">
          <div className={"fanbase-row " + (names.length > 6 ? "moving" : "")}>
            {(names.length > 6 ? [...names, ...names] : names).map((f, i) => (
              <a
                key={f.name + i}
                href={"https://x.com/" + f.x}
                target="_blank"
                rel="noreferrer"
                className="fanbase-chip"
                aria-hidden={i >= names.length ? "true" : undefined}
                tabIndex={i >= names.length ? -1 : undefined}
              >
                <PixelIcon name="user" size={11} />
                <b>{f.name}</b>
                <small>{f.focus}</small>
              </a>
            ))}
          </div>
        </div>
      )}
      <div className="fanbase-cta rv">
        <p>
          Kelola fanbase JKT48? Ajukan <b>program fanbase</b>: paket gratis
          tanpa batas waktu untuk bot, website, dan proyek komunitasmu.
        </p>
        <Link className="btn btn-ink" href="/dashboard/fanbase" data-magnetic>
          Ajukan fanbase <Icon size={14} />
        </Link>
      </div>
    </section>
  );
}

export function Footer({ guides = [] }) {
  return (
    <footer className="site-footer rv">
      <div className="footer-grid">
        <div className="footer-brand">
          <Link href="/" className="nav-brand">
            <span className="brand-tile">
              <Mark size={20} />
            </span>
            <span className="brand-word">
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
          <a href={SITE} target="_blank" rel="noreferrer">
            jkt48connect.com ↗
          </a>
          <Link href="/dashboard">Dashboard developer</Link>
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

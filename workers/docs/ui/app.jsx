import { useMotionEnabled } from "./motion.js";
import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { gsap, useLocation, useReveal, navigate } from "./shared.jsx";
import { Header } from "./header.jsx";
import { Landing } from "./landing.jsx";
import { SearchDialog } from "./search.jsx";
import { Assistant } from "./assistant.jsx";
import { Mark } from "./icons.jsx";
import {
  Sidebar,
  Overview,
  Reference,
  Guide,
  Toc,
  NotFound,
  DocsColophon,
} from "./docs.jsx";
import { routeKey, routeHref } from "./request.js";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/doto";
import "./theme.css";

// The developer area loads on demand: docs readers never download it.
const AuthPage = lazy(() =>
  import("./auth.jsx").then((m) => ({ default: m.AuthPage })),
);
const Dashboard = lazy(() =>
  import("./dashboard.jsx").then((m) => ({ default: m.Dashboard })),
);
const PayPage = lazy(() =>
  import("./dashboard.jsx").then((m) => ({ default: m.PayPage })),
);

function App({ catalog, guides }) {
  const motionEnabled = useMotionEnabled();
  const current = useLocation(),
    url = new URL(current, location.origin),
    docs = url.pathname.startsWith("/docs"),
    auth = /^\/(login|register)\/?$/.test(url.pathname),
    pay = url.pathname.match(/^\/pay\/(JKC[A-F0-9]{16})\/?$/),
    dashboard = url.pathname.startsWith("/dashboard") || Boolean(pay),
    [searchOpen, setSearch] = useState(false),
    article = useRef();
  const guide = guides.find((g) => url.pathname === "/docs/guide/" + g.slug),
    selected = catalog.routes.find(
      (r) => routeKey(r) === url.searchParams.get("route"),
    );
  useReveal(article, [url.pathname, url.search]);
  // Page transition: the article rises in, block by block.
  useEffect(() => {
    if (!motionEnabled || !docs) return;
    const target = document.querySelector("#main-content .docs-article");
    const animation =
      target &&
      gsap.fromTo(
        target.children,
        { opacity: 0, y: 18 },
        {
          opacity: 1,
          y: 0,
          duration: 0.7,
          stagger: 0.045,
          ease: "expo.out",
          clearProps: "opacity,transform",
        },
      );
    return () => animation?.revert();
  }, [url.pathname, url.search, motionEnabled]);
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
    if (auth || dashboard) {
      document.documentElement.dataset.view = auth ? "auth" : "dashboard";
      return;
    }
    document.title =
      (docs
        ? (guide?.title ||
            selected?.path ||
            (url.pathname === "/docs/reference"
              ? "API Reference"
              : "Dokumentasi")) + " · "
        : "") + "JKT48Connect Developers";
    document.documentElement.dataset.view = docs ? "docs" : "landing";
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
        catalog={catalog}
        guides={guides}
      />
      {auth || dashboard ? (
        <Suspense
          fallback={
            <main id="main-content" className="dash-boot">
              <div className="dash-skeleton">
                <i />
                <i />
                <i />
              </div>
            </main>
          }
        >
          {auth ? (
            <main id="main-content" className="auth-main">
              <AuthPage
                mode={
                  url.pathname.startsWith("/register") ? "register" : "login"
                }
              />
            </main>
          ) : pay ? (
            <PayPage id={pay[1]} />
          ) : (
            <Dashboard
              path={url.pathname.replace(/\/$/, "")}
              search={url.search}
            />
          )}
        </Suspense>
      ) : docs ? (
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
            <DocsColophon />
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
      <Assistant catalog={catalog} guides={guides} />
      <SearchDialog
        open={searchOpen}
        onClose={() => setSearch(false)}
        catalog={catalog}
        guides={guides}
      />
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

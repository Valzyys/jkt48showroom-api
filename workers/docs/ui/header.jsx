import React, { useEffect, useRef, useState } from "react";
import { useMotionEnabled } from "./motion.js";
import {
  gsap,
  ScrollTrigger,
  GitHub,
  Icon,
  Link,
  MotionToggle,
} from "./shared.jsx";
import { Mark, PixelIcon, GitHubIcon, guideIcon } from "./icons.jsx";

const NAV = [
  ["/docs", "Docs", "book"],
  ["/docs/reference", "Reference", "code"],
  ["/docs/guide/markdown", "Markdown", "markdown"],
];
function activeIndex(path) {
  if (path === "/docs/guide/markdown") return 2;
  if (path === "/docs/reference") return 1;
  if (path === "/docs" || path === "/docs/" || path.startsWith("/docs/guide/"))
    return 0;
  return -1;
}

// Jakarta time, ticking each second: the API speaks UTC, fans read WIB.
function Clock() {
  const [now, set] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => set(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const time = now.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Jakarta",
    hour12: false,
  });
  return (
    <span className="dock-clock" title="Waktu Jakarta (WIB)">
      <i className="live-dot" />
      <span className="clock-digits">{time}</span>
      <small>WIB</small>
    </span>
  );
}

export function Header({ current, onSearch, catalog, guides }) {
  const path = current.split(/[?#]/)[0],
    active = activeIndex(path),
    [hot, setHot] = useState(active),
    [menu, setMenu] = useState(false),
    dock = useRef(),
    nav = useRef(),
    pill = useRef(),
    motionEnabled = useMotionEnabled();
  useEffect(() => setHot(active), [active]);
  // Ink pill glides to the hovered or active item.
  useEffect(() => {
    const items = nav.current?.querySelectorAll("a[data-nav]");
    const target = items?.[hot];
    if (!pill.current) return;
    if (!target) {
      gsap.to(pill.current, { opacity: 0, scale: 0.9, duration: 0.25 });
      return;
    }
    const to = {
      x: target.offsetLeft,
      width: target.offsetWidth,
      opacity: 1,
      scale: 1,
    };
    if (motionEnabled)
      gsap.to(pill.current, { ...to, duration: 0.55, ease: "expo.out" });
    else gsap.set(pill.current, to);
  }, [hot, motionEnabled]);
  useEffect(() => {
    const trigger = ScrollTrigger.create({
      start: 24,
      onToggle: (self) =>
        dock.current?.classList.toggle("is-compact", self.isActive),
    });
    return () => trigger.kill();
  }, []);
  useEffect(() => {
    if (!motionEnabled) return;
    const context = gsap.context(() => {
      gsap.from(".dock", {
        y: -28,
        autoAlpha: 0,
        duration: 1,
        ease: "expo.out",
        clearProps: "transform,opacity,visibility",
      });
      gsap.from(".dock-nav a, .dock-right > *", {
        y: -10,
        autoAlpha: 0,
        duration: 0.7,
        stagger: 0.05,
        delay: 0.25,
        ease: "expo.out",
        clearProps: "transform,opacity,visibility",
      });
    });
    return () => context.revert();
  }, [motionEnabled]);
  useEffect(() => {
    const bar = document.querySelector(".dock-progress i");
    const update = () => {
      const length = document.documentElement.scrollHeight - innerHeight;
      if (bar)
        bar.style.transform =
          "scaleX(" + (length > 0 ? Math.min(1, scrollY / length) : 0) + ")";
    };
    addEventListener("scroll", update, { passive: true });
    update();
    return () => removeEventListener("scroll", update);
  }, [path]);
  return (
    <>
      <header className="dock-wrap">
        <div className="dock" ref={dock}>
          <Link
            href="/"
            className="dock-brand"
            aria-label="JKT48Connect, beranda"
          >
            <span className="brand-tile">
              <Mark size={20} />
            </span>
            <span className="brand-word">
              jkt48<b>connect</b>
            </span>
            <span className="brand-badge">DEV</span>
          </Link>
          <nav
            className="dock-nav"
            aria-label="Navigasi utama"
            ref={nav}
            onPointerLeave={() => setHot(active)}
          >
            <span className="dock-pill" ref={pill} aria-hidden="true" />
            {NAV.map(([href, label, icon], i) => (
              <Link
                key={href}
                href={href}
                data-nav
                className={i === hot ? "hot" : ""}
                aria-current={i === active ? "page" : undefined}
                onPointerEnter={() => setHot(i)}
                onFocus={() => setHot(i)}
                onBlur={() => setHot(active)}
              >
                <PixelIcon name={icon} size={13} />
                {label}
              </Link>
            ))}
          </nav>
          <div className="dock-right">
            <Clock />
            <button
              type="button"
              className="dock-search"
              onClick={onSearch}
              aria-label="Cari dokumentasi"
            >
              <Icon name="search" size={15} />
              <span>Cari</span>
              <kbd>⌘K</kbd>
            </button>
            <a
              className="dock-icon"
              href={GitHub}
              target="_blank"
              rel="noreferrer"
              aria-label="Source di GitHub"
            >
              <GitHubIcon size={16} />
            </a>
            <MotionToggle />
            <Link
              href="/docs/guide/mulai-menggunakan"
              className="btn btn-ink dock-cta"
            >
              Mulai <Icon size={14} />
            </Link>
            <button
              type="button"
              className="burger"
              aria-label={menu ? "Tutup menu" : "Buka menu"}
              aria-expanded={menu}
              onClick={() => setMenu(true)}
            >
              <i />
              <i />
            </button>
          </div>
          <span className="dock-progress" aria-hidden="true">
            <i />
          </span>
        </div>
      </header>
      <MenuOverlay
        open={menu}
        onClose={() => setMenu(false)}
        onSearch={onSearch}
        path={path}
        catalog={catalog}
        guides={guides}
      />
    </>
  );
}

function MenuOverlay({ open, onClose, onSearch, path, catalog, guides }) {
  const ref = useRef(),
    motionEnabled = useMotionEnabled(),
    closing = useRef(false);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      if (motionEnabled) {
        gsap.fromTo(
          dialog,
          { clipPath: "circle(0px at calc(100% - 44px) 40px)" },
          {
            clipPath: "circle(150% at calc(100% - 44px) 40px)",
            duration: 0.8,
            ease: "expo.inOut",
            clearProps: "clipPath",
          },
        );
        gsap.from(dialog.querySelectorAll(".menu-big a, .menu-guides a"), {
          y: 28,
          autoAlpha: 0,
          duration: 0.7,
          stagger: 0.035,
          delay: 0.25,
          ease: "expo.out",
          clearProps: "transform,opacity,visibility",
        });
      }
    }
  }, [open, motionEnabled]);
  function close() {
    const dialog = ref.current;
    if (!dialog?.open || closing.current) return;
    if (!motionEnabled) {
      dialog.close();
      return;
    }
    closing.current = true;
    gsap.to(dialog, {
      clipPath: "circle(0px at calc(100% - 44px) 40px)",
      duration: 0.55,
      ease: "expo.inOut",
      onComplete: () => {
        closing.current = false;
        gsap.set(dialog, { clearProps: "clipPath" });
        dialog.close();
      },
    });
  }
  useEffect(() => {
    const onNav = () => ref.current?.open && ref.current.close();
    addEventListener("docs:navigate", onNav);
    return () => removeEventListener("docs:navigate", onNav);
  }, []);
  const big = [
    ["/", "Beranda", "home"],
    ["/docs", "Dokumentasi", "book"],
    ["/docs/reference", "API Reference", "code"],
    ["/docs/guide/markdown", "Markdown lab", "markdown"],
  ];
  return (
    <dialog
      ref={ref}
      className="menu-overlay"
      aria-label="Menu navigasi"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="menu-inner">
        <div className="menu-head">
          <Link href="/" className="dock-brand" onClick={close}>
            <span className="brand-tile">
              <Mark size={20} />
            </span>
            <span className="brand-word">
              jkt48<b>connect</b>
            </span>
          </Link>
          <button
            type="button"
            className="burger open"
            aria-label="Tutup menu"
            onClick={close}
          >
            <i />
            <i />
          </button>
        </div>
        <button
          type="button"
          className="menu-search"
          onClick={() => {
            ref.current?.close();
            onSearch();
          }}
        >
          <Icon name="search" size={16} />
          Cari endpoint atau panduan…
        </button>
        <nav className="menu-big" aria-label="Halaman utama">
          {big.map(([href, label, icon], i) => (
            <Link
              key={href}
              href={href}
              className={path === href ? "current" : ""}
            >
              <span className="num">0{i + 1}</span>
              <PixelIcon name={icon} size={18} />
              <span className="label">{label}</span>
              {href === "/docs/reference" && (
                <small>{catalog.routes.length}</small>
              )}
              <Icon size={18} />
            </Link>
          ))}
        </nav>
        <span className="menu-label">PANDUAN & INTEGRASI</span>
        <nav className="menu-guides" aria-label="Panduan">
          {guides
            .filter((g) => g.slug !== "markdown")
            .map((g) => (
              <Link
                key={g.slug}
                href={"/docs/guide/" + g.slug}
                className={path === "/docs/guide/" + g.slug ? "current" : ""}
              >
                <PixelIcon name={guideIcon(g.slug)} size={14} />
                {g.title}
              </Link>
            ))}
        </nav>
        <div className="menu-foot">
          <MotionToggle withLabel />
          <a href={GitHub} target="_blank" rel="noreferrer">
            <GitHubIcon size={15} /> GitHub
          </a>
        </div>
      </div>
    </dialog>
  );
}

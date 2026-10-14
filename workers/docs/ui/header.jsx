import React, { useEffect, useRef, useState } from "react";
import { useMotionEnabled } from "./motion.js";
import {
  gsap,
  ScrollTrigger,
  GitHub,
  Icon,
  Link,
  MotionToggle,
  RollText,
  rollHandlers,
  useLiquid,
} from "./shared.jsx";
import { Mark, PixelIcon, GitHubIcon, guideIcon } from "./icons.jsx";

const NAV = [
  ["/", "Beranda", "home", "nav-home"],
  ["/docs", "Docs", "book", "nav-docs"],
  ["/docs/reference", "Reference", "code", "nav-reference"],
  ["/docs/guide/markdown", "Markdown", "markdown", "nav-markdown"],
];
function activeIndex(path) {
  if (path === "/") return 0;
  if (path === "/docs/guide/markdown") return 3;
  if (path === "/docs/reference") return 2;
  if (path.startsWith("/docs")) return 1;
  return -1;
}

// Split dock: three floating islands. The ink island in the middle carries
// navigation with a liquid pill; it hides on scroll down, returns on scroll up.
export function Header({ current, onSearch, catalog, guides }) {
  const path = current.split(/[?#]/)[0],
    active = activeIndex(path),
    [hot, setHot] = useState(active),
    [menu, setMenu] = useState(false),
    wrap = useRef(),
    island = useRef(),
    motionEnabled = useMotionEnabled(),
    liquid = useLiquid(island, "a.hot", [hot, path]);
  useEffect(() => setHot(active), [active]);
  useEffect(() => {
    const header = wrap.current;
    let hidden = false;
    const trigger = ScrollTrigger.create({
      start: 0,
      end: "max",
      onUpdate(self) {
        const y = self.scroll();
        header.classList.toggle("is-scrolled", y > 16);
        const hide = self.direction === 1 && y > 220;
        if (hide === hidden) return;
        hidden = hide;
        gsap.to(header, {
          yPercent: hide ? -140 : 0,
          duration: hide ? 0.5 : 0.7,
          ease: hide ? "power3.in" : "expo.out",
          overwrite: true,
        });
      },
    });
    return () => trigger.kill();
  }, []);
  useEffect(() => {
    if (!motionEnabled) return;
    const context = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
      tl.from(".nav-island", {
        clipPath: "inset(0% 42% 0% 42% round 999px)",
        duration: 1.1,
        clearProps: "clipPath",
      })
        .from(
          ".nav-island > :not(.nav-liquid)",
          {
            y: 14,
            autoAlpha: 0,
            duration: 0.7,
            stagger: 0.05,
            clearProps: "transform,opacity,visibility",
          },
          0.35,
        )
        .from(
          ".nav-brand",
          {
            x: -24,
            autoAlpha: 0,
            duration: 0.9,
            clearProps: "transform,opacity,visibility",
          },
          0.15,
        )
        .from(
          ".brand-tile",
          { rotate: -90, scale: 0.6, duration: 1.1, clearProps: "transform" },
          0.15,
        )
        .from(
          ".nav-actions",
          {
            x: 24,
            autoAlpha: 0,
            duration: 0.9,
            clearProps: "transform,opacity,visibility",
          },
          0.2,
        );
    }, wrap);
    return () => context.revert();
  }, [motionEnabled]);
  useEffect(() => {
    const bar = wrap.current?.querySelector(".nav-progress i");
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
  const roll = rollHandlers();
  return (
    <>
      <header className="nav-wrap" ref={wrap}>
        <div className="nav-bar">
          <Link
            href="/"
            className="nav-brand island"
            aria-label="JKT48Connect, beranda"
          >
            <span className="brand-tile">
              <Mark size={18} />
            </span>
            <span className="brand-word">
              jkt48<b>connect</b>
            </span>
            <span className="brand-badge">DEV</span>
          </Link>
          <nav
            className="nav-island"
            aria-label="Navigasi utama"
            ref={island}
            onPointerLeave={() => setHot(active)}
          >
            <span className="nav-liquid" ref={liquid} aria-hidden="true" />
            {NAV.map(([href, label, icon, pip], i) => (
              <Link
                key={href}
                href={href}
                data-pip={pip}
                className={"nav-link " + (i === hot ? "hot" : "")}
                aria-label={label}
                aria-current={i === active ? "page" : undefined}
                onPointerEnter={(e) => {
                  setHot(i);
                  roll.onPointerEnter(e);
                }}
                onPointerLeave={roll.onPointerLeave}
                onFocus={() => setHot(i)}
                onBlur={() => setHot(active)}
              >
                <PixelIcon name={icon} size={12} />
                <RollText text={label} />
              </Link>
            ))}
            <span className="nav-sep" aria-hidden="true" />
            <button
              type="button"
              className="nav-search"
              data-pip="nav-search"
              onClick={onSearch}
              aria-label="Cari dokumentasi"
              {...roll}
            >
              <PixelIcon name="search" size={12} />
              <RollText text="Cari" />
              <kbd>⌘K</kbd>
            </button>
            <button
              type="button"
              className={"burger " + (menu ? "open" : "")}
              aria-label={menu ? "Tutup menu" : "Buka menu"}
              aria-expanded={menu}
              onClick={() => setMenu(true)}
            >
              <i />
              <i />
            </button>
          </nav>
          <div className="nav-actions island">
            <a
              className="nav-icon"
              href={GitHub}
              target="_blank"
              rel="noreferrer"
              aria-label="Source di GitHub"
            >
              <GitHubIcon size={16} />
            </a>
            <MotionToggle pip="motion-toggle" />
            <Link
              href="/docs/guide/mulai-menggunakan"
              className="nav-cta"
              data-pip="nav-cta"
              aria-label="Mulai membangun"
              {...roll}
            >
              <RollText text="Mulai" />
              <span className="cta-arrow">
                <Icon size={13} />
              </span>
            </Link>
          </div>
        </div>
        <span className="nav-progress" aria-hidden="true">
          <i />
        </span>
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
    if (!dialog || !open || dialog.open) return;
    dialog.showModal();
    if (!motionEnabled) return;
    gsap.fromTo(
      dialog,
      { clipPath: "circle(0px at calc(100% - 40px) 36px)" },
      {
        clipPath: "circle(150% at calc(100% - 40px) 36px)",
        duration: 0.9,
        ease: "expo.inOut",
        clearProps: "clipPath",
      },
    );
    gsap.from(dialog.querySelectorAll(".menu-big a"), {
      yPercent: 60,
      autoAlpha: 0,
      duration: 0.8,
      stagger: 0.06,
      delay: 0.3,
      ease: "expo.out",
      clearProps: "transform,opacity,visibility",
    });
    gsap.from(dialog.querySelectorAll(".menu-guides a, .menu-foot > *"), {
      y: 16,
      autoAlpha: 0,
      duration: 0.6,
      stagger: 0.025,
      delay: 0.5,
      ease: "expo.out",
      clearProps: "transform,opacity,visibility",
    });
  }, [open, motionEnabled]);
  function close() {
    const dialog = ref.current;
    if (!dialog?.open || closing.current) return;
    if (!motionEnabled) return dialog.close();
    closing.current = true;
    gsap.to(dialog, {
      clipPath: "circle(0px at calc(100% - 40px) 36px)",
      duration: 0.6,
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
          <Link href="/" className="nav-brand" onClick={close}>
            <span className="brand-tile">
              <Mark size={18} />
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
          <PixelIcon name="search" size={14} />
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

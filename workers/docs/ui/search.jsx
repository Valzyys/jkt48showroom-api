import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMotionEnabled } from "./motion.js";
import { PixelIcon, guideIcon } from "./icons.jsx";
import { gsap, Icon, Link, navigate } from "./shared.jsx";
import { routeKey, routeHref } from "./request.js";

export function SearchDialog({ open, onClose, catalog, guides }) {
  const ref = useRef(),
    input = useRef(),
    list = useRef(),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0),
    motionEnabled = useMotionEnabled();
  useEffect(() => {
    const dialog = ref.current;
    if (open) {
      if (!dialog.open) dialog.showModal();
      input.current?.focus();
      input.current?.select();
      if (motionEnabled)
        gsap.fromTo(
          dialog,
          { y: -18, scale: 0.97, autoAlpha: 0 },
          {
            y: 0,
            scale: 1,
            autoAlpha: 1,
            duration: 0.5,
            ease: "expo.out",
            clearProps: "transform,opacity,visibility",
          },
        );
    } else dialog?.close();
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
        icon: guideIcon(g.slug),
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
    if (!open || !motionEnabled || !list.current) return;
    const tween = gsap.from(list.current.querySelectorAll("a"), {
      x: -8,
      autoAlpha: 0,
      duration: 0.35,
      stagger: 0.02,
      ease: "expo.out",
      clearProps: "transform,opacity,visibility",
    });
    return () => tween.revert();
  }, [needle, open]);
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
        <span className="search-glyph">
          <PixelIcon name="search" size={16} />
        </span>
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
          <kbd>esc</kbd>
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
            <span>Populer</span>
            {["recent", "member", "gold", "screenshot", "theater"].map((q) => (
              <button type="button" key={q} onClick={() => setQuery(q)}>
                {q}
              </button>
            ))}
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
                <span className="result-icon">
                  <PixelIcon name={r.icon} size={14} />
                </span>
              )}
              <span className="result-text">
                {r.title}
                <small>{r.detail}</small>
              </span>
              <span className="result-enter" aria-hidden="true">
                <Icon size={13} />
              </span>
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
          <kbd>↓</kbd> pilih <kbd>↵</kbd> buka <kbd>esc</kbd> tutup
        </span>
        <span>{results.length} hasil</span>
      </div>
    </dialog>
  );
}

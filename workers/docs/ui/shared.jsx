import React, { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { SplitText } from "gsap/SplitText";
import { motion, useMotionEnabled } from "./motion.js";
import { LangLogo, LANG_NAMES, langKind } from "./icons.jsx";
gsap.registerPlugin(ScrollTrigger, ScrambleTextPlugin, SplitText);
export { gsap, ScrollTrigger, SplitText, motion };

export const GitHub = "https://github.com/Valzyys/jkt48showroom-api";
export const BASE = "https://api.jkt48connect.app";
export const SCRAMBLE_CHARS = "01<>/_#*+=.:";

export function Icon({ name = "arrow", size = 18, ...props }) {
  const paths = {
    arrow: "M5 12h14m-6-6 6 6-6 6",
    search: "m20 20-4.5-4.5M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0",
    close: "m6 6 12 12M6 18 18 6",
    copy: "M9 9h11v11H9zM5 15H4V4h11v1",
    external: "M14 4h6v6m0-6-9 9M10 5H5v14h14v-5",
    check: "m5 12.5 4.5 4.5L19 7",
    play: "M8 5.5v13l10-6.5z",
    pause: "M9 5v14M15 5v14",
    down: "M12 4v15m-6-6 6 6 6-6",
    up: "M12 20V5m-6 6 6-6 6 6",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name] || paths.arrow} />
    </svg>
  );
}

export function navigate(href) {
  history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.dispatchEvent(new Event("docs:navigate"));
  window.scrollTo({ top: 0, behavior: "instant" });
}
export function Link({ href, children, onClick, ...props }) {
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
export function useLocation() {
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

export function Copy({ text, label = "Salin", className = "" }) {
  const [done, set] = useState(false),
    timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={"copy-button " + (done ? "done " : "") + className}
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

// Light tokenizer for code shown outside Markdown: strings, keywords,
// comments, numbers, and JSON keys. Output is React text, never HTML.
const TOKENS =
  /(\/\/[^\n]*|(?:^|\s)#[^\n]*)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|\b(const|let|await|async|import|from|return|if|throw|new|def|print|True|False|None|null|true|false|curl)\b|(-?\b\d+(?:\.\d+)?\b)/g;
export function tint(code) {
  if (code.length > 60000) return code;
  const out = [];
  let last = 0,
    m,
    i = 0;
  TOKENS.lastIndex = 0;
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

export function LangLabel({ language, label }) {
  const kind = langKind(language);
  return (
    <span className="lang-label">
      <LangLogo language={language} size={16} />
      <span>{label || LANG_NAMES[kind] || language}</span>
    </span>
  );
}
export const LANGUAGE_TABS = [
  ["curl", "cURL"],
  ["javascript", "JavaScript"],
  ["python", "Python"],
];
export function LanguageTabs({ value, onChange, options = LANGUAGE_TABS }) {
  const list = useRef(),
    pill = useRef();
  const motionEnabled = useMotionEnabled();
  useEffect(() => {
    const active = list.current?.querySelector('[aria-selected="true"]');
    if (!active || !pill.current) return;
    const to = {
      x: active.offsetLeft,
      width: active.offsetWidth,
      opacity: 1,
    };
    if (motionEnabled)
      gsap.to(pill.current, { ...to, duration: 0.45, ease: "expo.out" });
    else gsap.set(pill.current, to);
  }, [value, motionEnabled]);
  return (
    <span className="lang-tabs" role="tablist" aria-label="Bahasa" ref={list}>
      <span className="lang-pill" ref={pill} aria-hidden="true" />
      {options.map(([id, label]) => (
        <button
          type="button"
          key={id}
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
        >
          <LangLogo language={id} size={15} />
          {label}
        </button>
      ))}
    </span>
  );
}
export function CodeBlock({
  code,
  language = "text",
  label,
  head,
  tinted = true,
}) {
  return (
    <div className="code-block">
      <div className="code-toolbar">
        {head || <LangLabel language={language} label={label} />}
        <Copy text={code} />
      </div>
      <pre tabIndex={0}>
        <code>{tinted ? tint(code) : code}</code>
      </pre>
    </div>
  );
}

// Shared GSAP choreography. Every effect reverts on cleanup and is skipped
// while motion is off.
export function useReveal(scope, deps = []) {
  const motionEnabled = useMotionEnabled();
  useEffect(() => {
    if (!motionEnabled || !scope.current) return;
    const splits = [],
      removers = [];
    const context = gsap.context(() => {
      gsap.utils.toArray("[data-split]").forEach((el) => {
        const split = SplitText.create(el, {
          type: "lines,words",
          mask: "lines",
          linesClass: "split-line",
        });
        splits.push(split);
        gsap.from(split.lines, {
          yPercent: 105,
          duration: 1,
          ease: "expo.out",
          stagger: 0.08,
          scrollTrigger: { trigger: el, start: "top 88%", once: true },
        });
      });
      gsap.set(".rv", { autoAlpha: 0 });
      ScrollTrigger.batch(".rv", {
        start: "top 90%",
        once: true,
        onEnter: (batch) =>
          gsap.fromTo(
            batch,
            { y: 36, autoAlpha: 0, scale: 0.98 },
            {
              y: 0,
              autoAlpha: 1,
              scale: 1,
              duration: 0.9,
              ease: "expo.out",
              stagger: 0.09,
              clearProps: "transform,opacity,visibility",
            },
          ),
      });
      gsap.utils.toArray(".rv-clip").forEach((el) =>
        gsap.fromTo(
          el,
          { clipPath: "inset(14% 10% 14% 10% round 28px)" },
          {
            clipPath: "inset(0% 0% 0% 0% round 0px)",
            duration: 1.3,
            ease: "expo.inOut",
            scrollTrigger: { trigger: el, start: "top 85%", once: true },
            clearProps: "clipPath",
          },
        ),
      );
      gsap.utils.toArray("[data-scramble]").forEach((el) => {
        const text = el.textContent;
        gsap.to(el, {
          duration: Math.min(1.4, 0.35 + text.length * 0.025),
          scrambleText: { text, chars: SCRAMBLE_CHARS, speed: 0.6 },
          scrollTrigger: { trigger: el, start: "top 92%", once: true },
        });
      });
      gsap.utils.toArray("[data-count]").forEach((el) => {
        const value = Number(el.dataset.count),
          proxy = { v: 0 };
        gsap.to(proxy, {
          v: value,
          duration: 1.6,
          ease: "power3.out",
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
          delay: (i % 8) * 0.07,
          scrollTrigger: { trigger: el, start: "top 95%", once: true },
          clearProps: "width",
        }),
      );
      // Magnetic buttons: a small pull toward the pointer on fine pointers.
      if (matchMedia("(pointer: fine)").matches)
        gsap.utils.toArray("[data-magnetic]").forEach((el) => {
          const x = gsap.quickTo(el, "x", { duration: 0.5, ease: "power3" }),
            y = gsap.quickTo(el, "y", { duration: 0.5, ease: "power3" });
          const move = (e) => {
            const r = el.getBoundingClientRect();
            x((e.clientX - r.left - r.width / 2) * 0.22);
            y((e.clientY - r.top - r.height / 2) * 0.3);
          };
          const leave = () => {
            x(0);
            y(0);
          };
          el.addEventListener("pointermove", move);
          el.addEventListener("pointerleave", leave);
          removers.push(() => {
            el.removeEventListener("pointermove", move);
            el.removeEventListener("pointerleave", leave);
          });
        });
    }, scope);
    let active = true;
    document.fonts.ready.then(() => active && ScrollTrigger.refresh());
    return () => {
      active = false;
      removers.forEach((remove) => remove());
      context.revert();
      splits.forEach((s) => s.revert());
    };
  }, [motionEnabled, ...deps]);
}

export function MotionToggle({ withLabel = false }) {
  const enabled = useMotionEnabled();
  return (
    <button
      className={"motion-toggle " + (enabled ? "on" : "off")}
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
      <span className="motion-switch" aria-hidden="true">
        <i />
      </span>
      {withLabel && <span>Animasi {enabled ? "aktif" : "mati"}</span>}
    </button>
  );
}

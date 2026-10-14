import React, {
  Suspense,
  lazy,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Flip } from "gsap/Flip";
import { motion, useMotionEnabled } from "./motion.js";
import { gsap, Icon, navigate } from "./shared.jsx";
import { PixelIcon } from "./icons.jsx";
import { PipBot } from "./pip-bot.jsx";
import {
  cursorMoveTo,
  cursorClick,
  cursorFollow,
  cursorHide,
} from "./pip-cursor.js";
import { splitReply, resolveActions } from "./assistant-actions.js";
gsap.registerPlugin(Flip);
const MarkdownContent = lazy(() => import("./markdown.jsx"));
const STORE = "jkt48connect.pip";
const SUGGESTIONS = [
  ["Jelaskan halaman yang sedang kubuka", "book"],
  ["Buatkan kode JavaScript untuk ambil berita terbaru", "code"],
  ["Di mana tombol untuk mencoba endpoint?", "play"],
  ["Bagaimana cara memutar replay sebuah sesi?", "replay"],
];
const MOOD_TEXT = {
  idle: "Siap membantu",
  thinking: "Sedang berpikir…",
  reading: "Membaca docs…",
  talking: "Sedang menjawab…",
  pointing: "Menunjukkan di halaman…",
  happy: "Selesai!",
  error: "Ada kendala",
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function load() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE) || "[]");
    return Array.isArray(saved) ? saved.slice(-20) : [];
  } catch {
    return [];
  }
}
const visible = (el) => {
  if (!el || !el.getClientRects().length || el.closest(".pip-panel"))
    return false;
  const r = el.getBoundingClientRect();
  return (
    r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
  );
};

// Spotlight: scrolls a data-pip element into view, lets Pip's cursor reach
// it, then dims the page around it with a label. Dismisses on click, Escape,
// or after a few seconds.
let dismissActive = null;
export async function spotlight(id, label, hooks = {}) {
  dismissActive?.();
  const find = () =>
    [...document.querySelectorAll(`[data-pip="${CSS.escape(id)}"]`)].find(
      (el) => el.getClientRects().length > 0,
    );
  let el = find();
  for (let i = 0; !el && i < 25; i++) {
    await wait(100);
    el = find();
  }
  if (!el) return false;
  const animated = motion.getSnapshot();
  el.scrollIntoView({
    block: "center",
    behavior: animated ? "smooth" : "instant",
  });
  if (animated) await wait(450);
  hooks.onShow?.(el.getBoundingClientRect());
  await hooks.beforeRing?.(el);
  const ring = document.createElement("div"),
    tag = document.createElement("div"),
    face = document.createElement("b"),
    text = document.createElement("span");
  ring.className = "pip-spot";
  tag.className = "pip-spot-tag";
  face.textContent = "Pip";
  text.textContent = label;
  tag.append(face, text);
  // When Pip's cursor is there, its own tag carries the label.
  if (hooks.beforeRing) tag.hidden = true;
  document.body.append(ring, tag);
  el.classList.add("pip-target");
  let raf = 0;
  const place = () => {
    const r = el.getBoundingClientRect(),
      pad = 8;
    Object.assign(ring.style, {
      left: r.left - pad + "px",
      top: r.top - pad + "px",
      width: r.width + pad * 2 + "px",
      height: r.height + pad * 2 + "px",
    });
    const below = r.bottom + 60 < innerHeight;
    Object.assign(tag.style, {
      left: Math.max(12, Math.min(innerWidth - 300, r.left + 34)) + "px",
      top: (below ? r.bottom + pad + 10 : r.top - pad - 54) + "px",
    });
    hooks.onPlace?.(r);
    raf = requestAnimationFrame(place);
  };
  place();
  if (animated) {
    gsap.fromTo(
      ring,
      { opacity: 0, scale: 1.12 },
      { opacity: 1, scale: 1, duration: 0.6, ease: "expo.out" },
    );
    gsap.fromTo(
      tag,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.5, delay: 0.15, ease: "expo.out" },
    );
  }
  let done = false;
  const dismiss = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    removeEventListener("keydown", onKey);
    removeEventListener("pointerdown", dismiss, true);
    el.classList.remove("pip-target");
    const remove = () => {
      cancelAnimationFrame(raf);
      ring.remove();
      tag.remove();
    };
    if (motion.getSnapshot())
      gsap.to([ring, tag], { opacity: 0, duration: 0.3, onComplete: remove });
    else remove();
    if (dismissActive === dismiss) dismissActive = null;
    hooks.onHide?.();
  };
  const onKey = (e) => e.key === "Escape" && dismiss();
  const timer = setTimeout(dismiss, 7000);
  addEventListener("keydown", onKey);
  setTimeout(() => addEventListener("pointerdown", dismiss, true), 60);
  dismissActive = dismiss;
  return true;
}

export function dismissSpotlight() {
  dismissActive?.();
}

// The section heading the user is looking at, so "jelaskan bagian ini"
// works. The server only accepts headings that exist in the docs.
function currentHeading() {
  let found = "";
  for (const h of document.querySelectorAll("main h2, main h3")) {
    if (h.closest(".pip-panel") || !h.getClientRects().length) continue;
    if (h.getBoundingClientRect().top < innerHeight * 0.45)
      found = h.textContent.trim();
  }
  return found.slice(0, 120);
}

// Sources come from this server, but they also round-trip through
// sessionStorage, so only docs paths are ever followed.
const docsHref = (href) =>
  typeof href === "string" && /^\/docs(\/|$|\?)/.test(href) ? href : null;

function Sources({ sources, reading, onOpen }) {
  const list = useRef();
  const items = (sources || []).filter((s) => docsHref(s.href));
  useLayoutEffect(() => {
    if (!reading || !list.current || !motion.getSnapshot()) return;
    const tween = gsap.from(list.current.children, {
      x: -10,
      autoAlpha: 0,
      duration: 0.45,
      stagger: 0.12,
      ease: "expo.out",
      clearProps: "transform,opacity,visibility",
    });
    return () => tween.revert();
  }, [reading, items.length]);
  if (!items.length) return null;
  return (
    <div className={"pip-sources " + (reading ? "is-reading" : "")}>
      <span className="pip-sources-label">
        <PixelIcon name="book" size={11} />
        {reading
          ? `Membaca ${items.length} bagian docs…`
          : `Dibaca dari ${items.length} bagian docs`}
      </span>
      <ul ref={list}>
        {items.map((s, i) => (
          <li key={s.href + i}>
            <button
              type="button"
              onClick={() =>
                onOpen([
                  { type: "nav", href: docsHref(s.href), label: s.title },
                ])
              }
              title={"Buka " + s.title}
            >
              <PixelIcon
                name={s.kind === "endpoint" ? "code" : "book"}
                size={11}
              />
              <span>{s.title}</span>
              {s.section && <small>{s.section}</small>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function visibleTargets() {
  return [
    ...new Set(
      [...document.querySelectorAll("[data-pip]")]
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => el.dataset.pip),
    ),
  ];
}

// The link Pip "clicks" before navigating: the exact link when it is on
// screen (route row, sidebar guide), otherwise the matching header menu.
function linkFor(href) {
  const exact = [...document.querySelectorAll("a[href]")].find(
    (a) => a.getAttribute("href") === href && visible(a),
  );
  if (exact) return exact;
  const menu = href.startsWith("/docs/reference")
    ? "nav-reference"
    : href.startsWith("/docs/guide/markdown")
      ? "nav-markdown"
      : href.startsWith("/docs")
        ? "nav-docs"
        : "nav-home";
  return [...document.querySelectorAll(`[data-pip="${menu}"]`)].find(visible);
}

function Message({ message, onReplay }) {
  if (message.role === "user")
    return (
      <div className="pip-msg user">
        <p>{message.content}</p>
      </div>
    );
  const { text } = splitReply(message.content);
  return (
    <div className="pip-msg bot">
      <span className="pip-msg-who">
        <PipBot
          size={20}
          track={false}
          mood={
            message.error
              ? "error"
              : message.pending
                ? message.content
                  ? "talking"
                  : message.sources?.length
                    ? "reading"
                    : "thinking"
                : "idle"
          }
        />
        Pip
      </span>
      <Sources
        sources={message.sources}
        reading={message.pending && !text}
        onOpen={onReplay}
      />
      {text ? (
        <Suspense fallback={<p>{text}</p>}>
          <MarkdownContent source={text} />
        </Suspense>
      ) : message.pending ? (
        <span className="pip-typing" aria-label="Pip sedang mengetik">
          <i />
          <i />
          <i />
        </span>
      ) : null}
      {message.error && <p className="pip-error">{message.error}</p>}
      {message.actions?.length > 0 && (
        <div className="pip-actions">
          {message.actions.map((a, i) => (
            <button
              type="button"
              key={i}
              className={"pip-chip " + (a.missing ? "missing" : "")}
              onClick={() => onReplay([a])}
            >
              <PixelIcon
                name={a.type === "nav" ? "play" : "search"}
                size={11}
              />
              {a.type === "nav" ? "Buka " : "Tunjuk: "}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Assistant({ catalog, guides }) {
  const [open, setOpen] = useState(false),
    [full, setFull] = useState(false),
    [messages, setMessages] = useState(load),
    [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [mood, setMood] = useState("idle"),
    panel = useRef(),
    launcher = useRef(),
    body = useRef(),
    field = useRef(),
    abort = useRef(),
    flipState = useRef(null),
    moodTimer = useRef(),
    motionEnabled = useMotionEnabled();
  const settle = (next, after = 2600) => {
    clearTimeout(moodTimer.current);
    setMood(next);
    moodTimer.current = setTimeout(() => setMood("idle"), after);
  };
  useEffect(() => {
    try {
      sessionStorage.setItem(
        STORE,
        JSON.stringify(
          messages
            .filter((m) => !m.pending)
            .slice(-20)
            .map(({ role, content, actions, sources }) => ({
              role,
              content,
              actions,
              sources,
            })),
        ),
      );
    } catch {}
  }, [messages]);
  useEffect(() => {
    if (!motionEnabled || !launcher.current) return;
    const tween = gsap.from(launcher.current, {
      y: 40,
      scale: 0.8,
      autoAlpha: 0,
      duration: 1,
      delay: 1.1,
      ease: "back.out(1.6)",
      clearProps: "transform,opacity,visibility",
    });
    return () => tween.revert();
  }, [motionEnabled]);
  useEffect(() => {
    if (!open) return;
    field.current?.focus();
    if (motionEnabled && panel.current)
      gsap.fromTo(
        panel.current,
        { y: 24, scale: 0.94, autoAlpha: 0 },
        {
          y: 0,
          scale: 1,
          autoAlpha: 1,
          duration: 0.55,
          ease: "expo.out",
          clearProps: "transform,opacity,visibility",
        },
      );
  }, [open]);
  // Docked <-> fullscreen with GSAP Flip: the panel grows from where it sits.
  useLayoutEffect(() => {
    const state = flipState.current;
    flipState.current = null;
    if (!state || !panel.current) return;
    Flip.from(state, {
      duration: 0.75,
      ease: "expo.inOut",
      scale: false,
      simple: true,
    });
    const stage = panel.current.querySelector(".pip-stage");
    if (stage)
      gsap.from(stage.children, {
        y: 24,
        autoAlpha: 0,
        duration: 0.7,
        stagger: 0.06,
        delay: 0.35,
        ease: "expo.out",
        clearProps: "transform,opacity,visibility",
      });
  }, [full]);
  useEffect(() => {
    document.documentElement.classList.toggle("pip-fullscreen", open && full);
    return () => document.documentElement.classList.remove("pip-fullscreen");
  }, [open, full]);
  useEffect(() => {
    const box = body.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages, open, full]);
  useEffect(
    () => () => {
      abort.current?.abort();
      clearTimeout(moodTimer.current);
    },
    [],
  );
  function toggleFull(next = !full) {
    if (next === full) return;
    if (motionEnabled && panel.current)
      flipState.current = Flip.getState(panel.current);
    setFull(next);
  }
  function close() {
    cursorHide();
    if (!motionEnabled || !panel.current) {
      setFull(false);
      return setOpen(false);
    }
    gsap.to(panel.current, {
      y: 20,
      scale: 0.95,
      autoAlpha: 0,
      duration: 0.3,
      ease: "power2.in",
      onComplete: () => {
        gsap.set(panel.current, { clearProps: "all" });
        setFull(false);
        setOpen(false);
      },
    });
  }
  async function perform(actions) {
    if (full) {
      toggleFull(false);
      await wait(motionEnabled ? 800 : 50);
    }
    setMood("pointing");
    const results = [];
    let pointing = false;
    for (const action of actions) {
      if (action.type === "nav") {
        if (location.pathname + location.search !== action.href) {
          const link = linkFor(action.href);
          if (link) {
            await cursorMoveTo(link, "Membuka " + action.label);
            await cursorClick();
          }
          navigate(action.href);
          await wait(600);
        }
        results.push(action);
      } else {
        const found = await spotlight(action.id, action.label, {
          beforeRing: async (el) => {
            await cursorMoveTo(el, action.label);
            await cursorClick();
          },
          onPlace: cursorFollow,
          // Slide the panel down to its header while Pip points, so the
          // highlighted element is never hidden behind the chat.
          onShow: (rect) => {
            const box = panel.current?.getBoundingClientRect();
            if (
              !box ||
              (rect.right < box.left - 8 && innerWidth > 680) ||
              rect.bottom < box.top
            )
              return;
            panel.current.classList.add("is-peek");
            gsap.to(panel.current, {
              y: box.height - 66,
              duration: motion.getSnapshot() ? 0.55 : 0,
              ease: "expo.out",
            });
          },
          onHide: () => {
            cursorHide(150);
            if (!panel.current?.classList.contains("is-peek")) return;
            panel.current.classList.remove("is-peek");
            gsap.to(panel.current, {
              y: 0,
              duration: motion.getSnapshot() ? 0.6 : 0,
              ease: "expo.out",
            });
          },
        });
        pointing ||= found;
        results.push(found ? action : { ...action, missing: true });
      }
    }
    if (!pointing) cursorHide(700);
    settle("happy");
    return results;
  }
  async function send(text) {
    const question = text.trim();
    if (!question || busy) return;
    setInput("");
    const history = [
      ...messages
        .filter((m) => !m.pending && !m.error)
        .map((m) => ({
          role: m.role,
          content:
            m.role === "assistant" ? splitReply(m.content).text : m.content,
        })),
      { role: "user", content: question },
    ].slice(-12);
    setMessages((list) => [
      ...list,
      { role: "user", content: question },
      { role: "assistant", content: "", pending: true },
    ]);
    setBusy(true);
    clearTimeout(moodTimer.current);
    setMood("thinking");
    const controller = new AbortController();
    abort.current = controller;
    const update = (patch) =>
      setMessages((list) => {
        const next = [...list];
        next[next.length - 1] = { ...next[next.length - 1], ...patch };
        return next;
      });
    let raw = "";
    try {
      const response = await fetch("/docs/assistant", {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: history,
          page: {
            path: location.pathname + location.search,
            title: document.title,
            heading: currentHeading(),
            targets: visibleTargets(),
          },
        }),
      });
      if (!response.ok || !response.body) {
        let message = "Pip sedang tidak bisa menjawab.";
        try {
          message = (await response.json()).message || message;
        } catch {}
        throw Object.assign(new Error(message), { friendly: true });
      }
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const line = buffer.slice(0, cut).replace(/^data:\s*/, "");
          buffer = buffer.slice(cut + 2);
          let data;
          try {
            data = JSON.parse(line);
          } catch {
            continue;
          }
          if (Array.isArray(data.sources)) {
            setMood("reading");
            update({ sources: data.sources.slice(0, 6) });
          } else if (data.t) {
            if (!raw) setMood("talking");
            raw += data.t;
            update({ content: raw });
          } else if (data.error)
            throw Object.assign(new Error(data.error), { friendly: true });
        }
      }
      const actions = resolveActions(raw, catalog, guides);
      update({ content: raw, pending: false, actions });
      setBusy(false);
      if (actions.length) update({ actions: await perform(actions) });
      else settle("happy");
    } catch (error) {
      settle("error", 3200);
      update({
        pending: false,
        content: raw,
        error:
          error.name === "AbortError"
            ? "Dihentikan."
            : error.friendly
              ? error.message
              : "Koneksi terputus. Coba lagi.",
      });
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }
  const header = (
    <header
      className="pip-head"
      onClick={() => {
        if (panel.current?.classList.contains("is-peek")) dismissSpotlight();
      }}
    >
      {!full && (
        <span className="pip-avatar">
          <PipBot size={30} mood={mood} />
        </span>
      )}
      <div className="pip-title">
        <strong>Pip</strong>
        <small>
          <i className={"live-dot mood-" + mood} /> {MOOD_TEXT[mood]}
        </small>
      </div>
      <button
        type="button"
        className="pip-icon-btn"
        onClick={() => {
          abort.current?.abort();
          setMessages([]);
          setMood("idle");
        }}
        aria-label="Mulai percakapan baru"
        title="Percakapan baru"
      >
        <PixelIcon name="replay" size={13} />
      </button>
      <button
        type="button"
        className="pip-icon-btn"
        onClick={() => toggleFull()}
        aria-label={full ? "Keluar dari layar penuh" : "Layar penuh"}
        aria-pressed={full}
        title={full ? "Keluar dari layar penuh" : "Layar penuh"}
      >
        <Icon name={full ? "collapse" : "expand"} size={15} />
      </button>
      <button
        type="button"
        className="pip-icon-btn"
        onClick={close}
        aria-label="Tutup Pip"
      >
        <Icon name="close" size={15} />
      </button>
    </header>
  );
  return (
    <>
      <button
        ref={launcher}
        type="button"
        className={"pip-launcher " + (open ? "is-open" : "")}
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-controls="pip-panel"
        aria-label={open ? "Tutup Pip" : "Tanya Pip, asisten docs"}
      >
        <span className="pip-face" aria-hidden="true">
          <PipBot size={30} mood={open ? "happy" : mood} />
        </span>
        <span className="pip-launch-text">
          <b>Tanya Pip</b>
          <small>AI · bisa menunjuk UI</small>
        </span>
      </button>
      {open && (
        <section
          id="pip-panel"
          className={"pip-panel " + (full ? "is-full" : "")}
          role="dialog"
          aria-label="Pip, asisten dokumentasi"
          ref={panel}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            full ? toggleFull(false) : close();
          }}
        >
          {full && (
            <aside className="pip-stage">
              <div className="pip-hero">
                <PipBot size={176} mood={mood} />
                <span className="pip-floor" aria-hidden="true" />
              </div>
              <div className="pip-stage-copy">
                <h2>Pip</h2>
                <p>{MOOD_TEXT[mood]}</p>
              </div>
              <ul className="pip-caps">
                <li>
                  <PixelIcon name="book" size={13} /> Membaca isi docs sebelum
                  menjawab
                </li>
                <li>
                  <PixelIcon name="search" size={13} /> Menggerakkan kursor dan
                  menunjuk UI
                </li>
                <li>
                  <PixelIcon name="code" size={13} /> Menulis kode JS, Python,
                  cURL
                </li>
              </ul>
              <div className="pip-suggest">
                {SUGGESTIONS.map(([q, icon]) => (
                  <button type="button" key={q} onClick={() => send(q)}>
                    <PixelIcon name={icon} size={12} />
                    {q}
                  </button>
                ))}
              </div>
            </aside>
          )}
          <div className="pip-main">
            {header}
            <div className="pip-body" ref={body} aria-live="polite">
              <div className="pip-thread">
                {!messages.length && (
                  <div className="pip-intro">
                    {!full && (
                      <div className="pip-intro-bot">
                        <PipBot size={64} mood={mood} />
                      </div>
                    )}
                    <p>
                      Hai, aku <b>Pip</b>! Tanyakan apa saja soal API ini. Aku
                      membaca isi docs ini dulu sebelum menjawab, lalu bisa
                      menunjukkan letaknya di halaman, membuka endpoint, dan
                      membuatkan kode.
                    </p>
                    {!full && (
                      <div className="pip-suggest">
                        {SUGGESTIONS.map(([q, icon]) => (
                          <button type="button" key={q} onClick={() => send(q)}>
                            <PixelIcon name={icon} size={12} />
                            {q}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {messages.map((m, i) => (
                  <Message key={i} message={m} onReplay={perform} />
                ))}
              </div>
            </div>
            <form
              className="pip-form"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <textarea
                ref={field}
                rows={1}
                value={input}
                maxLength={2000}
                placeholder="Tanya Pip…"
                aria-label="Pertanyaan untuk Pip"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    send(input);
                  }
                }}
              />
              {busy ? (
                <button
                  type="button"
                  className="pip-send stop"
                  onClick={() => abort.current?.abort()}
                  aria-label="Hentikan jawaban"
                >
                  <i />
                </button>
              ) : (
                <button
                  type="submit"
                  className="pip-send"
                  disabled={!input.trim()}
                  aria-label="Kirim"
                >
                  <Icon name="up" size={16} />
                </button>
              )}
            </form>
            <p className="pip-note">
              Pip bisa keliru. Cek ulang di referensi sebelum dipakai produksi.
            </p>
          </div>
        </section>
      )}
    </>
  );
}

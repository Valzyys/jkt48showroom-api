import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { motion, useMotionEnabled } from "./motion.js";
import { gsap, Icon, navigate } from "./shared.jsx";
import { PixelIcon } from "./icons.jsx";
import { splitReply, resolveActions } from "./assistant-actions.js";
const MarkdownContent = lazy(() => import("./markdown.jsx"));
const STORE = "jkt48connect.pip";
const FACES = ["( o.o )", "( -.- )", "( o.o )", "( ^.^ )"];
const THINK = ["( o.o )", "( o.o)", "(o.o )", "( ._. )"];
const SUGGESTIONS = [
  ["Buatkan kode JavaScript untuk ambil berita terbaru", "code"],
  ["Di mana tombol untuk mencoba endpoint?", "play"],
  ["Endpoint apa untuk data live yang sedang berlangsung?", "live"],
  ["Bagaimana cara memutar replay sebuah sesi?", "replay"],
];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function load() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE) || "[]");
    return Array.isArray(saved) ? saved.slice(-20) : [];
  } catch {
    return [];
  }
}

// Spotlight: scrolls a data-pip element into view, dims the page around it,
// and labels it. Dismisses on click, Escape, or after a few seconds.
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
  const ring = document.createElement("div"),
    tag = document.createElement("div"),
    face = document.createElement("b"),
    text = document.createElement("span");
  ring.className = "pip-spot";
  tag.className = "pip-spot-tag";
  face.textContent = "(^.^)/";
  text.textContent = label;
  tag.append(face, text);
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
      left: Math.max(12, Math.min(innerWidth - 300, r.left)) + "px",
      top: (below ? r.bottom + pad + 10 : r.top - pad - 54) + "px",
    });
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
  const timer = setTimeout(dismiss, 6500);
  addEventListener("keydown", onKey);
  setTimeout(() => addEventListener("pointerdown", dismiss, true), 60);
  dismissActive = dismiss;
  return true;
}

export function dismissSpotlight() {
  dismissActive?.();
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
    [messages, setMessages] = useState(load),
    [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [frame, setFrame] = useState(0),
    panel = useRef(),
    launcher = useRef(),
    body = useRef(),
    field = useRef(),
    abort = useRef(),
    motionEnabled = useMotionEnabled();
  useEffect(() => {
    try {
      sessionStorage.setItem(
        STORE,
        JSON.stringify(
          messages
            .filter((m) => !m.pending)
            .slice(-20)
            .map(({ role, content, actions }) => ({ role, content, actions })),
        ),
      );
    } catch {}
  }, [messages]);
  useEffect(() => {
    if (!motionEnabled) return setFrame(0);
    const id = setInterval(() => setFrame((f) => f + 1), busy ? 320 : 2200);
    return () => clearInterval(id);
  }, [busy, motionEnabled]);
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
  useEffect(() => {
    const box = body.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages, open]);
  useEffect(() => () => abort.current?.abort(), []);
  function close() {
    if (!motionEnabled || !panel.current) return setOpen(false);
    gsap.to(panel.current, {
      y: 20,
      scale: 0.95,
      autoAlpha: 0,
      duration: 0.3,
      ease: "power2.in",
      onComplete: () => {
        gsap.set(panel.current, { clearProps: "all" });
        setOpen(false);
      },
    });
  }
  async function perform(actions) {
    const results = [];
    for (const action of actions) {
      if (action.type === "nav") {
        if (location.pathname + location.search !== action.href) {
          navigate(action.href);
          await wait(550);
        }
        results.push(action);
      } else {
        const found = await spotlight(action.id, action.label, {
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
            if (!panel.current?.classList.contains("is-peek")) return;
            panel.current.classList.remove("is-peek");
            gsap.to(panel.current, {
              y: 0,
              duration: motion.getSnapshot() ? 0.6 : 0,
              ease: "expo.out",
            });
          },
        });
        results.push(found ? action : { ...action, missing: true });
      }
    }
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
          if (data.t) {
            raw += data.t;
            update({ content: raw });
          } else if (data.error)
            throw Object.assign(new Error(data.error), { friendly: true });
        }
      }
      const actions = resolveActions(raw, catalog, guides);
      update({ content: raw, pending: false, actions });
      if (actions.length) {
        const results = await perform(actions);
        update({ actions: results });
      }
    } catch (error) {
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
  const face = (busy ? THINK : FACES)[frame % 4];
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
          {open ? "( -_- )" : face}
        </span>
        <span className="pip-launch-text">
          <b>Tanya Pip</b>
          <small>AI · bisa menunjuk UI</small>
        </span>
      </button>
      {open && (
        <section
          id="pip-panel"
          className="pip-panel"
          role="dialog"
          aria-label="Pip, asisten dokumentasi"
          ref={panel}
          onKeyDown={(e) => e.key === "Escape" && close()}
        >
          <header
            className="pip-head"
            onClick={() => {
              if (panel.current?.classList.contains("is-peek"))
                dismissSpotlight();
            }}
          >
            <span className="pip-avatar" aria-hidden="true">
              {face}
            </span>
            <div>
              <strong>Pip</strong>
              <small>
                <i className="live-dot" /> Asisten docs · menjawab, menunjuk,
                menulis kode
              </small>
            </div>
            <button
              type="button"
              className="pip-icon-btn"
              onClick={() => {
                abort.current?.abort();
                setMessages([]);
              }}
              aria-label="Mulai percakapan baru"
              title="Percakapan baru"
            >
              <PixelIcon name="replay" size={13} />
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
          <div className="pip-body" ref={body} aria-live="polite">
            {!messages.length && (
              <div className="pip-intro">
                <pre aria-hidden="true">
                  {" /\\_/\\\n( o.o )  hai!\n > ^ <"}
                </pre>
                <p>
                  Aku <b>Pip</b>. Tanyakan apa saja soal API ini. Aku bisa
                  menunjukkan letaknya di halaman, membuka endpoint, dan
                  membuatkan kode.
                </p>
                <div className="pip-suggest">
                  {SUGGESTIONS.map(([q, icon]) => (
                    <button type="button" key={q} onClick={() => send(q)}>
                      <PixelIcon name={icon} size={12} />
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <Message key={i} message={m} onReplay={perform} />
            ))}
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
        </section>
      )}
    </>
  );
}

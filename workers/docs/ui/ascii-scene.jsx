import React, { useEffect, useRef } from "react";
import { motion } from "./motion.js";
import { renderFrame, RAMP } from "./ascii.js";

const FONT = '"Geist Mono Variable", ui-monospace, monospace';

// Canvas host for the ASCII engine. Renders only while visible, follows the
// shared motion preference, and draws one still frame when motion is off.
export function AsciiScene({
  shape = "globe",
  size = 11,
  speed = 0.32,
  sway = 0,
  yaw = 0.5,
  pitch = 0.32,
  zoom = 1,
  interactive = false,
  className = "",
}) {
  const host = useRef(),
    canvas = useRef();
  useEffect(() => {
    const el = host.current,
      cv = canvas.current,
      ctx = cv.getContext("2d");
    if (!ctx) return;
    const state = {
      cols: 0,
      rows: 0,
      cw: 0,
      lh: 0,
      fs: size,
      tiltX: 0,
      tiltY: 0,
      targetX: 0,
      targetY: 0,
      spin: 0,
      angle: 0,
      t: 0,
      last: 0,
      revealStart: 0,
      revealed: !motion.getSnapshot(),
      visible: false,
      raf: 0,
      colors: {},
    };
    const fps = (navigator.hardwareConcurrency || 4) <= 4 ? 16 : 24;
    function measure() {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return false;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      state.fs =
        width < 420 ? Math.max(7, size - 3) : width < 640 ? size - 1 : size;
      ctx.font = state.fs + "px " + FONT;
      state.cw = ctx.measureText("M").width || state.fs * 0.6;
      state.lh = Math.round(state.fs * 1.18);
      state.cols = Math.max(8, Math.floor(width / state.cw));
      state.rows = Math.max(6, Math.floor(height / state.lh));
      cv.width = Math.round(width * dpr);
      cv.height = Math.round(height * dpr);
      cv.style.width = width + "px";
      cv.style.height = height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const css = getComputedStyle(el);
      state.colors = {
        ink: css.getPropertyValue("--ascii-ink").trim() || "#111",
        accent: css.getPropertyValue("--ascii-accent").trim() || "#e5002b",
        dim: css.getPropertyValue("--ascii-dim").trim() || "#b8b8bc",
      };
      // grid offset centers the character block inside the box
      state.ox = (width - state.cols * state.cw) / 2;
      state.oy = (height - state.rows * state.lh) / 2;
      return true;
    }
    function draw(now) {
      if (!state.cols) return;
      const currentYaw = sway
          ? yaw + Math.sin(state.t * speed) * sway + state.angle
          : yaw + state.t * speed + state.angle,
        frame = renderFrame(shape, {
          cols: state.cols,
          rows: state.rows,
          aspect: state.cw / state.lh,
          yaw: currentYaw + state.tiltX * 0.5,
          pitch: pitch + state.tiltY * 0.35,
          t: state.t,
          zoom,
        });
      let layers = frame.layers;
      // Scan-in: the figure is always drawn (never an empty box); a band of
      // noise sweeps down once when it first becomes visible.
      if (!state.revealed && state.revealStart) {
        const p = Math.min(1, (now - state.revealStart) / 1000);
        if (p >= 1) state.revealed = true;
        else {
          const line = p * (state.rows + 8) - 4,
            scramble = (row, r) =>
              Math.abs(r - line) > 2.5
                ? row
                : row.replace(
                    /\S/g,
                    () => RAMP[(Math.random() * RAMP.length) | 0],
                  );
          layers = layers.map((rows) => rows.map(scramble));
        }
      }
      const { width, height } = cv;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const dpr = Math.min(devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = state.fs + "px " + FONT;
      ctx.textBaseline = "top";
      const palette = [
        shape === "globe" ? state.colors.dim : state.colors.ink,
        state.colors.accent,
        state.colors.ink,
      ];
      for (let k = 0; k < 3; k++) {
        const rows = layers[k];
        ctx.fillStyle = palette[k];
        for (let r = 0; r < rows.length; r++)
          if (rows[r].trim())
            // draw per run so glyph advance never drifts across a row
            for (let c = 0; c < rows[r].length; c++) {
              const ch = rows[r][c];
              if (ch !== " ")
                ctx.fillText(
                  ch,
                  state.ox + c * state.cw,
                  state.oy + r * state.lh,
                );
            }
      }
    }
    function tick(now) {
      state.raf = 0;
      if (!state.visible || document.hidden || !motion.getSnapshot()) return;
      if (now - state.last < 1000 / fps) return schedule();
      const dt = state.last ? Math.min(0.1, (now - state.last) / 1000) : 0;
      state.last = now;
      state.t += dt;
      state.tiltX += (state.targetX - state.tiltX) * Math.min(1, dt * 5);
      state.tiltY += (state.targetY - state.tiltY) * Math.min(1, dt * 5);
      state.angle += state.spin * dt;
      state.spin *= Math.pow(0.12, dt);
      draw(now);
      schedule();
    }
    function schedule() {
      if (
        !state.raf &&
        state.visible &&
        motion.getSnapshot() &&
        !document.hidden
      )
        state.raf = requestAnimationFrame(tick);
    }
    function still() {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
      state.revealed = true;
      state.tiltX = state.tiltY = 0;
      draw(performance.now());
    }
    const ro = new ResizeObserver(() => {
      if (measure())
        motion.getSnapshot() ? (draw(performance.now()), schedule()) : still();
    });
    const io = new IntersectionObserver(
      ([entry]) => {
        state.visible = entry.isIntersecting;
        if (state.visible && !state.revealStart) {
          state.revealStart = performance.now();
        }
        if (state.visible) schedule();
      },
      { threshold: 0.05 },
    );
    const move = (e) => {
      const r = el.getBoundingClientRect();
      state.targetX = Math.max(
        -1,
        Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1),
      );
      state.targetY = Math.max(
        -1,
        Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1),
      );
    };
    const leave = () => (state.targetX = state.targetY = 0);
    const click = () => {
      state.spin += 5;
      schedule();
    };
    const target = interactive ? el.closest("[data-ascii-stage]") || el : null;
    if (target) {
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerleave", leave);
      target.addEventListener("click", click);
    }
    const unsubscribe = motion.subscribe(() =>
      motion.getSnapshot() ? ((state.last = 0), schedule()) : still(),
    );
    const visibility = () => ((state.last = 0), schedule());
    document.addEventListener("visibilitychange", visibility);
    let alive = true;
    // Canvas text needs the bundled mono face before measuring cells.
    (document.fonts?.load
      ? document.fonts.load(size + "px " + FONT)
      : Promise.resolve()
    )
      .catch(() => {})
      .then(() => {
        if (!alive) return;
        ro.observe(el);
        io.observe(el);
      });
    return () => {
      alive = false;
      cancelAnimationFrame(state.raf);
      ro.disconnect();
      io.disconnect();
      unsubscribe();
      document.removeEventListener("visibilitychange", visibility);
      if (target) {
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerleave", leave);
        target.removeEventListener("click", click);
      }
    };
  }, [shape, size, speed, sway, yaw, pitch, zoom, interactive]);
  return (
    <div ref={host} className={"ascii-scene " + className} aria-hidden="true">
      <canvas ref={canvas} />
    </div>
  );
}

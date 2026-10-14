import React, { useEffect, useRef } from "react";

// Pip: a cat-eared pixel robot. Moods swap the visor face; the eyes follow
// the pointer, blink, and the mouth moves while Pip is talking.
const MOOD_EYES = {
  idle: [
    [6, 8, 2, 2.4],
    [10, 8, 2, 2.4],
  ],
  talking: [
    [6, 8, 2, 2.4],
    [10, 8, 2, 2.4],
  ],
  pointing: [
    [6.4, 8, 2, 2.4],
    [10.4, 8, 2, 2.4],
  ],
  thinking: [
    [6.6, 7.6, 2, 1.3],
    [10.6, 7.6, 2, 1.3],
  ],
  happy: [
    [5.6, 9.2, 1, 1],
    [6.6, 8.2, 1, 1],
    [7.6, 9.2, 1, 1],
    [9.6, 9.2, 1, 1],
    [10.6, 8.2, 1, 1],
    [11.6, 9.2, 1, 1],
  ],
  error: [
    [5.6, 7.8, 1, 1],
    [7.4, 7.8, 1, 1],
    [6.5, 8.7, 1, 1],
    [5.6, 9.6, 1, 1],
    [7.4, 9.6, 1, 1],
    [9.6, 7.8, 1, 1],
    [11.4, 7.8, 1, 1],
    [10.5, 8.7, 1, 1],
    [9.6, 9.6, 1, 1],
    [11.4, 9.6, 1, 1],
  ],
};

export function PipBot({
  mood = "idle",
  size = 40,
  className = "",
  track = true,
}) {
  const eyes = useRef();
  useEffect(() => {
    if (!track) return;
    let raf = 0,
      px = 0,
      py = 0;
    const apply = () => {
      raf = 0;
      const group = eyes.current,
        svg = group?.ownerSVGElement;
      if (!svg) return;
      const r = svg.getBoundingClientRect(),
        dx = px - (r.left + r.width / 2),
        dy = py - (r.top + r.height / 2),
        d = Math.hypot(dx, dy) || 1,
        k = Math.min(1, d / 220);
      group.setAttribute(
        "transform",
        `translate(${((dx / d) * 0.8 * k).toFixed(2)} ${((dy / d) * 0.6 * k).toFixed(2)})`,
      );
    };
    const move = (e) => {
      px = e.clientX;
      py = e.clientY;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    addEventListener("pointermove", move, { passive: true });
    return () => {
      removeEventListener("pointermove", move);
      cancelAnimationFrame(raf);
    };
  }, [track]);
  const face = MOOD_EYES[mood] || MOOD_EYES.idle,
    round = mood === "happy" || mood === "error" ? 0.25 : 0.6;
  return (
    <svg
      className={"pip-bot mood-" + mood + " " + className}
      width={size}
      height={size}
      viewBox="0 -1.5 19 18.5"
      aria-hidden="true"
    >
      <g className="pip-think">
        <circle cx="16.2" cy="2.4" r=".55" />
        <circle cx="17.3" cy="0.9" r=".7" />
        <circle cx="18.2" cy="-0.8" r=".55" />
      </g>
      <rect
        className="pip-antenna"
        x="8"
        y="-0.6"
        width="2"
        height="2"
        rx=".8"
      />
      <rect x="8.5" y="1.2" width="1" height="2.6" fill="var(--pip-ink)" />
      <path
        d="M2.4 5.2 3.2 1.8l2.6 2.6zM15.6 5.2l-.8-3.4-2.6 2.6z"
        fill="var(--pip-ink)"
      />
      <rect
        x="1"
        y="3.6"
        width="16"
        height="12.4"
        rx="3.4"
        fill="var(--pip-ink)"
      />
      <rect
        x="2"
        y="4.6"
        width="14"
        height="10.4"
        rx="2.6"
        fill="var(--pip-face)"
      />
      <rect
        x="3.4"
        y="6.2"
        width="11.2"
        height="6.4"
        rx="2"
        fill="var(--pip-ink)"
      />
      <g ref={eyes}>
        <g className="pip-eyes">
          {face.map(([x, y, w, h], i) => (
            <rect
              key={mood + i}
              x={x}
              y={y}
              width={w}
              height={h}
              rx={round}
              fill="var(--pip-led)"
            />
          ))}
        </g>
      </g>
      <rect
        className="pip-mouth"
        x="8.2"
        y="11"
        width="1.6"
        height=".8"
        rx=".4"
        fill="var(--accent)"
      />
      <rect
        x="3"
        y="13.2"
        width="1.8"
        height="1"
        rx=".5"
        fill="var(--pip-cheek)"
      />
      <rect
        x="13.2"
        y="13.2"
        width="1.8"
        height="1"
        rx=".5"
        fill="var(--pip-cheek)"
      />
    </svg>
  );
}

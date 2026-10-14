import { useMotionEnabled } from "./motion.js";
import React, { useEffect, useRef, useState } from "react";
const faces = [
  String.raw` /\_/\
( o.o )
 > ^ <`,
  String.raw` /\_/\
( -.- )
 > ^ <`,
  String.raw` /\_/\
( o.o )
 > ^ <`,
  String.raw` /\_/\
( ^.^ )
 > ~ <`,
];
export function AsciiFriend({ compact = false }) {
  const el = useRef(),
    [frame, setFrame] = useState(0),
    motionEnabled = useMotionEnabled();
  useEffect(() => {
    if (!motionEnabled) {
      setFrame(0);
      return;
    }
    let timer,
      step = 0,
      visible = false;
    const update = () => {
      clearInterval(timer);
      if (visible && !document.hidden)
        timer = setInterval(() => setFrame(++step % faces.length), 1800);
    };
    const scroll = () => {
      if (visible) setFrame(Math.floor(scrollY / 360) % faces.length);
    };
    const io = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      update();
    });
    io.observe(el.current);
    addEventListener("scroll", scroll, { passive: true });
    document.addEventListener("visibilitychange", update);

    update();
    return () => {
      clearInterval(timer);
      io.disconnect();
      removeEventListener("scroll", scroll);
      document.removeEventListener("visibilitychange", update);
    };
  }, [motionEnabled]);
  return (
    <span ref={el} className={"ascii-friend " + (compact ? "compact" : "")}>
      <pre aria-hidden="true">{faces[frame]}</pre>
      {!compact && (
        <span>
          SMALL FRIEND.
          <br />
          BIG FAN ENERGY.
        </span>
      )}
    </span>
  );
}
export function LittleBadge() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <rect
        x="10"
        y="17"
        width="44"
        height="35"
        rx="12"
        fill="#e6e9e2"
        stroke="#90978d"
      />
      <rect x="16" y="24" width="32" height="18" rx="6" fill="#303a35" />
      <path
        d="M25 30v5m14-5v5"
        stroke="#ecf2da"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M30 15V9m-19 22H7m50 0h-4M22 53v4m20-4v4"
        stroke="#92998e"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="30" cy="8" r="3" fill="#d5373f" />
    </svg>
  );
}

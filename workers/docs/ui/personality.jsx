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
// Pip, the small ASCII companion. Blinks only while visible and motion is on.
export function AsciiFriend({ caption }) {
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
    const io = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      update();
    });
    io.observe(el.current);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [motionEnabled]);
  return (
    <span ref={el} className="ascii-friend">
      <pre aria-hidden="true">{faces[frame]}</pre>
      {caption && <span>{caption}</span>}
    </span>
  );
}

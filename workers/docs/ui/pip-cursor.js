import { gsap } from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { motion } from "./motion.js";
gsap.registerPlugin(MotionPathPlugin);

// Pip's own pointer. It travels on a soft arc from the chat to whatever Pip
// is about to use, clicks with a ripple, and parks there while it points.
let el, label, at, hideTimer;
const MARKUP = `<svg class="pip-cursor-arrow" width="26" height="30" viewBox="0 0 26 30"><path d="M3 2.5v22.2l6.1-5.5 3.9 8.6 4.2-1.9-3.9-8.5 8.2-.6z" fill="var(--accent)" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg><span class="pip-cursor-tag"><svg width="16" height="16" viewBox="0 -1.5 19 18.5"><rect x="1" y="3.6" width="16" height="12.4" rx="3.4" fill="#fff"/><rect x="3.4" y="6.2" width="11.2" height="6.4" rx="2" fill="#131315"/><rect x="6" y="8" width="2" height="2.4" rx=".6" fill="#e9fff2"/><rect x="10" y="8" width="2" height="2.4" rx=".6" fill="#e9fff2"/></svg><b>Pip</b><span></span></span><i class="pip-cursor-ripple"></i>`;

function ensure() {
  if (el?.isConnected) return el;
  el = document.createElement("div");
  el.className = "pip-cursor";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = MARKUP;
  label = el.querySelector(".pip-cursor-tag > span");
  document.body.append(el);
  gsap.set(el, { x: -100, y: -100, autoAlpha: 0 });
  return el;
}

const pointOf = (target) => {
  const r = target.getBoundingClientRect
    ? target.getBoundingClientRect()
    : target;
  return {
    x: r.left + Math.min(26, r.width * 0.35),
    y: r.top + Math.min(r.height * 0.62, r.height - 4),
  };
};

function origin() {
  const from = document.querySelector(".pip-panel, .pip-launcher");
  if (!from) return { x: innerWidth - 60, y: innerHeight - 60 };
  const r = from.getBoundingClientRect();
  return { x: r.left + 40, y: r.top + 30 };
}

// Near the right edge the tag sits on the cursor's left so it stays readable.
const side = (p) => el.classList.toggle("flip", p.x > innerWidth - 250);

export function cursorStatus(text) {
  ensure();
  label.textContent = text || "";
}

export function cursorMoveTo(target, status) {
  const node = ensure(),
    to = pointOf(target);
  clearTimeout(hideTimer);
  cursorStatus(status);
  gsap.killTweensOf(node);
  if (!at) {
    at = origin();
    gsap.set(node, { x: at.x, y: at.y });
    gsap.to(node, { autoAlpha: 1, scale: 1, duration: 0.3 });
  } else gsap.set(node, { autoAlpha: 1 });
  const from = at;
  at = to;
  side(to);
  if (!motion.getSnapshot()) {
    gsap.set(node, { x: to.x, y: to.y });
    return Promise.resolve();
  }
  const dx = to.x - from.x,
    dy = to.y - from.y,
    dist = Math.hypot(dx, dy),
    // bend the path sideways so it reads as a hand moving, not a slide
    mid = {
      x: from.x + dx / 2 - dy * 0.18,
      y: from.y + dy / 2 + dx * 0.18,
    };
  return new Promise((resolve) =>
    gsap.to(node, {
      motionPath: { path: [mid, to], curviness: 1.3 },
      duration: Math.min(1.25, Math.max(0.55, dist / 950)),
      ease: "power3.inOut",
      onComplete: resolve,
    }),
  );
}

export function cursorClick() {
  const node = ensure();
  if (!motion.getSnapshot()) return Promise.resolve();
  const arrow = node.querySelector(".pip-cursor-arrow"),
    ripple = node.querySelector(".pip-cursor-ripple");
  return new Promise((resolve) =>
    gsap
      .timeline({ onComplete: resolve })
      .to(arrow, { scale: 0.78, duration: 0.12, ease: "power2.out" })
      .fromTo(
        ripple,
        { scale: 0.2, autoAlpha: 0.9 },
        { scale: 2.6, autoAlpha: 0, duration: 0.55, ease: "expo.out" },
        "<",
      )
      .to(arrow, { scale: 1, duration: 0.35, ease: "back.out(3)" }, "<0.08"),
  );
}

// Keep the cursor glued to a target while the page scrolls under it.
export function cursorFollow(rect) {
  if (!el || !at || gsap.isTweening(el)) return;
  at = pointOf(rect);
  side(at);
  gsap.set(el, { x: at.x, y: at.y });
}

export function cursorHide(delay = 0) {
  if (!el) return;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    gsap.to(el, {
      autoAlpha: 0,
      scale: 0.6,
      duration: 0.35,
      onComplete: () => (at = null),
    });
  }, delay);
}

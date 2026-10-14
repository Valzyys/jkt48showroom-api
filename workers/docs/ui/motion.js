import { useSyncExternalStore } from "react";
import { createMotionPreference } from "./motion-preference.js";
let storage;
try {
  storage = window.localStorage;
} catch {}
export const motion = createMotionPreference({
  media: matchMedia("(prefers-reduced-motion: reduce)"),
  storage,
  eventTarget: window,
  root: document.documentElement,
});
export function useMotionEnabled() {
  return useSyncExternalStore(
    motion.subscribe,
    motion.getSnapshot,
    () => false,
  );
}

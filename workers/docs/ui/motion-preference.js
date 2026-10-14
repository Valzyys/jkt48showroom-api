export const MOTION_STORAGE_KEY = "jkt48connect.motion";

// One preference controls CSS, GSAP, ASCII, and the WebGL scene together.
export function createMotionPreference({ media, storage, eventTarget, root }) {
  let preference = "auto";
  try {
    const saved = storage?.getItem(MOTION_STORAGE_KEY);
    if (saved === "on" || saved === "off") preference = saved;
  } catch {}
  const listeners = new Set();
  const resolve = () =>
    preference === "auto" ? !media.matches : preference === "on";
  let enabled = resolve();
  function publish() {
    const next = resolve();
    if (root) root.dataset.motion = next ? "on" : "off";
    if (next === enabled) return;
    enabled = next;
    for (const listener of listeners) listener();
  }
  function storageChanged(event) {
    if (event.key !== MOTION_STORAGE_KEY && event.key !== null) return;
    preference =
      event.newValue === "on" || event.newValue === "off"
        ? event.newValue
        : "auto";
    publish();
  }
  media.addEventListener("change", publish);
  eventTarget?.addEventListener("storage", storageChanged);
  publish();
  return {
    getSnapshot: () => enabled,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getPreference: () => preference,
    setEnabled(value) {
      preference = value ? "on" : "off";
      try {
        storage?.setItem(MOTION_STORAGE_KEY, preference);
      } catch {}
      publish();
    },
    reset() {
      preference = "auto";
      try {
        storage?.removeItem(MOTION_STORAGE_KEY);
      } catch {}
      publish();
    },
    destroy() {
      listeners.clear();
      media.removeEventListener("change", publish);
      eventTarget?.removeEventListener("storage", storageChanged);
    },
  };
}

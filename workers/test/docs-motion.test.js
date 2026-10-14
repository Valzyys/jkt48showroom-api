import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMotionPreference,
  MOTION_STORAGE_KEY,
} from "../docs/ui/motion-preference.js";
function fixture(reduced = false, saved = null) {
  const media = new EventTarget();
  media.matches = reduced;
  const events = new EventTarget(),
    root = { dataset: {} },
    values = new Map(saved ? [[MOTION_STORAGE_KEY, saved]] : []);
  const storage = {
    getItem: (k) => values.get(k) || null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
  const store = createMotionPreference({
    media,
    storage,
    eventTarget: events,
    root,
  });
  return { store, media, events, root, values, storage };
}
test("motion follows the OS until a visitor explicitly chooses and survives reload", () => {
  const f = fixture(true);
  assert.equal(f.store.getSnapshot(), false);
  assert.equal(f.root.dataset.motion, "off");
  let changes = 0;
  f.store.subscribe(() => changes++);
  f.store.setEnabled(true);
  assert.equal(f.store.getSnapshot(), true);
  assert.equal(f.root.dataset.motion, "on");
  assert.equal(f.values.get(MOTION_STORAGE_KEY), "on");
  assert.equal(changes, 1);
  f.media.dispatchEvent(new Event("change"));
  assert.equal(f.store.getSnapshot(), true);
  assert.equal(changes, 1);
  const reload = createMotionPreference({
    media: f.media,
    storage: f.storage,
    root: { dataset: {} },
  });
  assert.equal(reload.getSnapshot(), true);
  reload.destroy();
  f.store.setEnabled(false);
  assert.equal(f.store.getSnapshot(), false);
  f.store.reset();
  assert.equal(f.store.getPreference(), "auto");
  f.media.matches = false;
  f.media.dispatchEvent(new Event("change"));
  assert.equal(f.store.getSnapshot(), true);
  f.store.destroy();
});
test("motion synchronizes tab changes and tolerates blocked storage", () => {
  const f = fixture(false);
  const changed = new Event("storage");
  Object.defineProperties(changed, {
    key: { value: MOTION_STORAGE_KEY },
    newValue: { value: "off" },
  });
  f.events.dispatchEvent(changed);
  assert.equal(f.store.getSnapshot(), false);
  assert.equal(f.root.dataset.motion, "off");
  f.store.destroy();
  const media = new EventTarget();
  media.matches = true;
  const store = createMotionPreference({
    media,
    storage: {
      getItem() {
        throw Error("blocked");
      },
      setItem() {
        throw Error("blocked");
      },
      removeItem() {
        throw Error("blocked");
      },
    },
    root: { dataset: {} },
  });
  assert.equal(store.getSnapshot(), false);
  assert.doesNotThrow(() => store.setEnabled(true));
  assert.equal(store.getSnapshot(), true);
  assert.doesNotThrow(() => store.reset());
  assert.equal(store.getSnapshot(), false);
  store.destroy();
});

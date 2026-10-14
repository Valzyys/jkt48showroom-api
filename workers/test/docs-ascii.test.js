import { test } from "node:test";
import assert from "node:assert/strict";
import { renderFrame, shapes, RAMP } from "../docs/ui/ascii.js";

test("ASCII engine renders every shape into aligned, non-empty layers", () => {
  for (const name of Object.keys(shapes)) {
    const frame = renderFrame(name, {
      cols: 60,
      rows: 28,
      aspect: 0.5,
      yaw: 0.7,
      pitch: 0.4,
      t: 1,
    });
    assert.equal(frame.layers.length, 3, name);
    for (const layer of frame.layers) {
      assert.equal(layer.length, 28, name);
      for (const row of layer) assert.equal(row.length, 60, name);
    }
    assert.ok(frame.lit > 60, name + " draws a visible figure");
    // a cell belongs to at most one material
    for (let r = 0; r < 28; r++)
      for (let c = 0; c < 60; c++)
        assert.ok(
          frame.layers.filter((layer) => layer[r][c] !== " ").length <= 1,
        );
  }
});

test("ASCII engine is deterministic, uses its ramps, and marks Jakarta in accent", () => {
  // yaw that turns longitude 106.8° toward the camera
  const yaw = (106.8 * Math.PI) / 180 - Math.PI / 2,
    options = { cols: 80, rows: 36, aspect: 0.5, yaw, pitch: 0, t: 0 };
  assert.deepEqual(
    renderFrame("globe", options),
    renderFrame("globe", options),
  );
  const glyphs = new Set(
    renderFrame("cube", options).layers.flat().join("").replace(/ /g, ""),
  );
  for (const g of glyphs) assert.ok(RAMP.includes(g), g);
  // The marker sits just below the center row, near the middle column.
  const accent = renderFrame("globe", options).layers[1],
    hits = accent.flatMap((row, r) =>
      [...row].map((ch, c) => (ch === " " ? null : [r, c])).filter(Boolean),
    );
  assert.ok(
    hits.some(([r, c]) => r >= 18 && r <= 21 && Math.abs(c - 40) <= 4),
    "Jakarta marker faces the camera",
  );
  // Off-canvas sizes stay safe.
  assert.equal(
    renderFrame("globe", { cols: 1, rows: 1 }).layers[0][0].length,
    1,
  );
});

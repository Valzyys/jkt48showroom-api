// ASCII 3D engine. Shapes are signed distance fields, rendered with an
// orthographic camera and flat Lambert light only: no specular highlight,
// no reflection, and no cast shadow. Pure functions, so Node tests can run it.
export const RAMP = ".,:;-=+*#%@";

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const length3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

function roundedBox(x, y, z, bx, by, bz, r) {
  const qx = Math.abs(x) - bx + r,
    qy = Math.abs(y) - by + r,
    qz = Math.abs(z) - bz + r;
  return (
    length3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) +
    Math.min(Math.max(qx, Math.max(qy, qz)), 0) -
    r
  );
}
function torus(x, y, z, R, r) {
  const q = Math.sqrt(x * x + z * z) - R;
  return Math.sqrt(q * q + y * y) - r;
}

// Ring plane of the globe: tilted so the orbit reads in three dimensions.
const RING_TILT = 0.42,
  RING_COS = Math.cos(RING_TILT),
  RING_SIN = Math.sin(RING_TILT);
const LINE = Math.PI / 6,
  JAKARTA = [(-6.2 * Math.PI) / 180, (106.8 * Math.PI) / 180];

// "48" drawn on a 7 x 5 pixel grid, merged into rectangles [col, row, w, h].
const DIGITS = [
  [0, 0, 1, 3, 0],
  [2, 0, 1, 5, 0],
  [1, 2, 1, 1, 0],
  [4, 0, 1, 5, 1],
  [6, 0, 1, 5, 1],
  [5, 0, 1, 1, 1],
  [5, 2, 1, 1, 1],
  [5, 4, 1, 1, 1],
].map(([c, r, w, h, m]) => {
  const px = 0.27;
  return {
    cx: (c + w / 2 - 3.5) * px,
    cy: -(r + h / 2 - 2.5) * px,
    hx: (w * px) / 2,
    hy: (h * px) / 2,
    m,
  };
});

// Each shape returns distance and writes the material:
// 0 base, 1 accent, 2 strong. Scenes pick a color per material.
export const shapes = {
  globe: {
    bound: 1.66,
    // the surface stays light so the wireframe reads on top of it
    ramp: [" ..,,::;;", RAMP, RAMP],
    sdf(x, y, z, t, out) {
      const sphere = length3(x, y, z) - 1;
      // ring: rotate into the ring plane around X
      const ry = y * RING_COS - z * RING_SIN,
        rz = y * RING_SIN + z * RING_COS;
      const ring = torus(x, ry, rz, 1.5, 0.03);
      const a = t * 0.9,
        sx = x - Math.cos(a) * 1.5,
        sz = rz - Math.sin(a) * 1.5;
      const satellite = length3(sx, ry, sz) - 0.1;
      let d = sphere,
        m = 0;
      if (ring < d) ((d = ring), (m = 2));
      if (satellite < d) ((d = satellite), (m = 1));
      if (d === sphere) {
        const r = length3(x, y, z) || 1,
          lat = Math.asin(clamp(y / r, -1, 1)),
          lon = Math.atan2(z, x),
          fl = Math.abs(lat / LINE - Math.round(lat / LINE)),
          fo = Math.abs(lon / LINE - Math.round(lon / LINE));
        // Jakarta, -6.2 / 106.8, marked in the accent color
        const dl = lat - JAKARTA[0],
          dn = Math.atan2(
            Math.sin(lon - JAKARTA[1]),
            Math.cos(lon - JAKARTA[1]),
          );
        if (dl * dl + dn * dn * Math.cos(lat) ** 2 < 0.02) m = 1;
        else if (fl < 0.09 || fo * Math.max(0.35, Math.cos(lat)) < 0.06) m = 2;
      }
      out.m = m;
      return d;
    },
  },
  cube: {
    bound: 1.1,
    sdf(x, y, z, t, out) {
      out.m = 0;
      return roundedBox(x, y, z, 0.62, 0.62, 0.62, 0.1);
    },
  },
  torus: {
    bound: 1.08,
    sdf(x, y, z, t, out) {
      out.m = 0;
      return torus(x, y, z, 0.74, 0.3);
    },
  },
  cross: {
    bound: 0.98,
    sdf(x, y, z, t, out) {
      const a = roundedBox(x, y, z, 0.86, 0.24, 0.24, 0.07),
        b = roundedBox(x, y, z, 0.24, 0.86, 0.24, 0.07),
        c = roundedBox(x, y, z, 0.24, 0.24, 0.86, 0.07),
        core = length3(x, y, z) - 0.36;
      out.m = core < Math.min(a, b, c) + 0.02 ? 1 : 0;
      return Math.min(a, b, c, core);
    },
  },
  48: {
    bound: 1.16,
    sdf(x, y, z, t, out) {
      // The enclosing box is a safe lower bound while the ray is far away.
      const outer = roundedBox(x, y, z, 0.96, 0.7, 0.2, 0.035);
      if (outer > 0.08) {
        out.m = 0;
        return outer;
      }
      let d = Infinity,
        m = 0;
      for (const b of DIGITS) {
        const v = roundedBox(x - b.cx, y - b.cy, z, b.hx, b.hy, 0.2, 0.035);
        if (v < d) ((d = v), (m = b.m));
      }
      out.m = m;
      return d;
    },
  },
};

// Row-major rotation, object to world: R = Ry(yaw) * Rx(pitch).
function rotation(yaw, pitch) {
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw),
    cp = Math.cos(pitch),
    sp = Math.sin(pitch);
  return [cy, sy * sp, sy * cp, 0, cp, -sp, -sy, cy * sp, cy * cp];
}
// World to object is the transpose.
function toObject(R, x, y, z) {
  return [
    R[0] * x + R[3] * y + R[6] * z,
    R[1] * x + R[4] * y + R[7] * z,
    R[2] * x + R[5] * y + R[8] * z,
  ];
}

/**
 * Render one frame into three layers of equal-length strings (base, accent,
 * strong), one per material. `aspect` is the
 * cell width divided by cell height, so circles stay round in any font.
 */
export function renderFrame(
  name,
  { cols, rows, aspect = 0.55, yaw = 0, pitch = 0, t = 0, zoom = 1 },
) {
  const shape = shapes[name] || shapes.globe,
    B = shape.bound,
    R = rotation(yaw, pitch),
    [dx, dy, dz] = toObject(R, 0, 0, -1),
    [lx, ly, lz] = (() => {
      const l = toObject(R, -0.5, 0.62, 0.6),
        n = length3(...l);
      return [l[0] / n, l[1] / n, l[2] / n];
    })(),
    // world units per cell, fitted to the shorter side
    unit = (2 * B) / Math.min(cols * aspect, rows) / zoom,
    out = { m: 0 },
    layers = [[], [], []],
    eps = 0.0015;
  let lit = 0;
  for (let r = 0; r < rows; r++) {
    const row = ["", "", ""];
    const wy = -(r + 0.5 - rows / 2) * unit;
    for (let c = 0; c < cols; c++) {
      const wx = (c + 0.5 - cols / 2) * unit * aspect,
        rr = wx * wx + wy * wy;
      if (rr >= B * B) {
        row[0] += " ";
        row[1] += " ";
        row[2] += " ";
        continue;
      }
      const half = Math.sqrt(B * B - rr),
        [ox, oy, oz] = toObject(R, wx, wy, half);
      let t0 = 0,
        hit = false;
      for (let i = 0; i < 64 && t0 <= 2 * half; i++) {
        const d = shape.sdf(ox + dx * t0, oy + dy * t0, oz + dz * t0, t, out);
        if (d < 0.003) {
          hit = true;
          break;
        }
        t0 += d * 0.9;
      }
      if (!hit) {
        row[0] += " ";
        row[1] += " ";
        row[2] += " ";
        continue;
      }
      const px = ox + dx * t0,
        py = oy + dy * t0,
        pz = oz + dz * t0,
        material = out.m,
        probe = { m: 0 },
        f = (x, y, z) => shape.sdf(x, y, z, t, probe);
      // tetrahedral gradient: four samples
      const k1 = f(px + eps, py - eps, pz - eps),
        k2 = f(px - eps, py - eps, pz + eps),
        k3 = f(px - eps, py + eps, pz - eps),
        k4 = f(px + eps, py + eps, pz + eps);
      let nx = k1 - k2 - k3 + k4,
        ny = -k1 - k2 + k3 + k4,
        nz = -k1 + k2 - k3 + k4;
      const nl = length3(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const lambert = Math.max(0, nx * lx + ny * ly + nz * lz),
        ramp = shape.ramp ? shape.ramp[material] : RAMP,
        ch =
          ramp[
            Math.round(clamp(0.26 + lambert * 0.74, 0, 1) * (ramp.length - 1))
          ];
      lit++;
      for (let k = 0; k < 3; k++) row[k] += k === material ? ch : " ";
    }
    for (let k = 0; k < 3; k++) layers[k].push(row[k]);
  }
  return { layers, lit };
}

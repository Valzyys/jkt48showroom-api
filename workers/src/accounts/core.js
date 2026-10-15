import { catalog } from "../docs/assets.js";

// Shared pieces of the developer accounts: plans, quota periods, tokens, and
// password hashing. Quotas are monthly in WIB (UTC+7), matching the audience.
const encoder = new TextEncoder();
const WIB = 7 * 3600 * 1000;

export const PLANS = {
  free: { label: "Free", monthly: 1000 },
  starter: { label: "Starter", monthly: 25000 },
  pro: { label: "Pro", monthly: 150000 },
  // Free for verified fan communities; granted by an admin after review.
  fanbase: { label: "Fanbase", monthly: 50000 },
};
export function plans(bindings = {}) {
  const free = Number(bindings.API_FREE_MONTHLY_LIMIT);
  const fanbase = Number(bindings.API_FANBASE_MONTHLY_LIMIT);
  return {
    ...PLANS,
    fanbase: {
      ...PLANS.fanbase,
      monthly:
        Number.isSafeInteger(fanbase) && fanbase > 0
          ? fanbase
          : PLANS.fanbase.monthly,
    },
    free: {
      ...PLANS.free,
      monthly:
        Number.isSafeInteger(free) && free > 0 ? free : PLANS.free.monthly,
    },
  };
}
// What can be bought through the payment gateway. Prices are in rupiah and
// can be overridden with API_PRICES, e.g. {"starter-30d":20000}.
export const PRODUCTS = {
  "starter-30d": {
    kind: "plan",
    plan: "starter",
    days: 30,
    price: 15000,
    label: "Starter · 30 hari",
  },
  "pro-30d": {
    kind: "plan",
    plan: "pro",
    days: 30,
    price: 49000,
    label: "Pro · 30 hari",
  },
  "topup-5k": {
    kind: "topup",
    requests: 5000,
    price: 5000,
    label: "Isi ulang +5.000 request",
  },
  "topup-25k": {
    kind: "topup",
    requests: 25000,
    price: 20000,
    label: "Isi ulang +25.000 request",
  },
  "topup-100k": {
    kind: "topup",
    requests: 100000,
    price: 60000,
    label: "Isi ulang +100.000 request",
  },
};
export function products(bindings = {}) {
  let prices = {};
  try {
    prices = JSON.parse(bindings.API_PRICES || "{}") || {};
  } catch {}
  return Object.fromEntries(
    Object.entries(PRODUCTS).map(([id, p]) => {
      const price = Number(prices[id]);
      return [
        id,
        {
          ...p,
          price: Number.isSafeInteger(price) && price >= 100 ? price : p.price,
        },
      ];
    }),
  );
}
// A bought plan lapses back to Free when its days run out; plans set by an
// admin have no expiry.
export function effectiveLimit(key, bindings = {}, now = Date.now()) {
  const lapsed =
    key.plan !== "free" && key.plan_expires_at && key.plan_expires_at <= now;
  return {
    plan: lapsed ? "free" : key.plan,
    monthly: lapsed ? plans(bindings).free.monthly : key.monthly_limit,
  };
}

export const maxKeys = (bindings = {}) => {
  const value = Number(bindings.API_MAX_KEYS);
  return Number.isSafeInteger(value) && value > 0 ? value : 3;
};
// Developer accounts with these emails are administrators: they open the
// Admin view of the dashboard and the control panel with their own session.
export const adminEmails = (bindings = {}) =>
  String(bindings.DASHBOARD_ADMIN_EMAILS || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
export const isAdmin = (account, bindings) =>
  Boolean(account?.email) &&
  adminEmails(bindings).includes(String(account.email).toLowerCase());

export const keysRequired = (bindings = {}) =>
  String(bindings.API_KEY_REQUIRED || "false") === "true";

export function period(now = Date.now()) {
  return new Date(now + WIB).toISOString().slice(0, 7);
}
export function day(now = Date.now()) {
  return new Date(now + WIB).toISOString().slice(0, 10);
}
// First instant of the next WIB month, as epoch milliseconds.
export function resetsAt(now = Date.now()) {
  const local = new Date(now + WIB);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - WIB;
}

export const hex = (bytes) =>
  Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("");
export const randomHex = (size) =>
  hex(crypto.getRandomValues(new Uint8Array(size)));
export async function sha256(value) {
  return hex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(String(value))),
    ),
  );
}

// Same format the control panel verifies: pbkdf2-sha256$100000$salt$digest.
export async function hashPassword(password) {
  const salt = randomHex(16);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(salt),
      iterations: 100000,
    },
    key,
    256,
  );
  return `pbkdf2-sha256$100000$${salt}$${hex(new Uint8Array(bits))}`;
}

const KEY_PATTERN = /^jkc_[a-f0-9]{40}$/;
export const looksLikeKey = (value) =>
  typeof value === "string" && KEY_PATTERN.test(value);
export function newKey() {
  const key = "jkc_" + randomHex(20);
  return { key, prefix: key.slice(0, 10), last4: key.slice(-4) };
}
// Voucher codes read well aloud and avoid look-alike characters.
const VOUCHER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newVoucher() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, (b) => VOUCHER_ALPHABET[b % 32]).join("");
  return `JKC-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}
export const normalizeVoucher = (code) =>
  String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^JKC/, "");

// Group request paths by their documented route so analytics stay readable:
// /api/news/123 counts under GET /api/news/:id.
let matchers;
export function routeOf(method, pathname) {
  matchers ||= catalog.routes
    .filter((r) => r.path.startsWith("/api/"))
    .map((r) => ({
      method: r.method,
      path: r.path,
      test: new RegExp(
        "^" +
          r.path
            .split("/")
            .map((part) =>
              part.startsWith(":")
                ? "[^/]+"
                : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            )
            .join("/") +
          "/?$",
      ),
    }));
  const verb = method === "HEAD" ? "GET" : method;
  const hit =
    matchers.find((m) => m.method === verb && m.test.test(pathname)) ||
    matchers.find((m) => m.test.test(pathname));
  if (hit) return `${verb} ${hit.path}`;
  const [, , first] = pathname.split("/");
  return `${verb} /api/${(first || "").slice(0, 40)}${pathname.split("/").length > 3 ? "/…" : ""}`;
}

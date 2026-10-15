import { verifyPassword } from "../control/auth.js";
import {
  day,
  effectiveLimit,
  hashPassword,
  maxKeys,
  newKey,
  normalizeVoucher,
  period,
  plans,
  products,
  randomHex,
  resetsAt,
  sha256,
  keysRequired,
} from "./core.js";
import { forgetKey } from "./metering.js";
import {
  cancelPayment,
  createPayment,
  publicPayment,
  refreshPayment,
} from "./payments.js";
import {
  followHandle,
  latestApplication,
  listedFanbases,
  readApplication,
  submitApplication,
} from "./fanbase.js";

// /dashboard/api: developer accounts, API keys, analytics and top-ups.
// Sessions are random tokens in an HttpOnly cookie; only their hash is stored.
export const SESSION = "__Host-jkc_session";
const SESSION_DAYS = 30;
const MAX_BODY = 8 * 1024;
// Verifying against a fixed hash keeps unknown emails as slow as wrong
// passwords, so login timing does not reveal who has an account.
const DECOY =
  "pbkdf2-sha256$100000$00000000000000000000000000000000$" + "0".repeat(64);

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};
const json = (value, status = 200, extra = {}) =>
  Response.json(value, { status, headers: { ...headers, ...extra } });
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};

async function readBody(request) {
  if (!/application\/json/.test(request.headers.get("Content-Type") || ""))
    fail(415, "Gunakan application/json");
  const text = await request.text();
  if (text.length > MAX_BODY) fail(413, "Data terlalu besar");
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object") throw 0;
    return value;
  } catch {
    fail(400, "JSON tidak valid");
  }
}

async function limited(bindings, key, windowMs, limit) {
  const namespace = bindings.COORDINATOR;
  if (!namespace) return;
  const response = await namespace
    .get(namespace.idFromName("account-auth"))
    .fetch("https://accounts.internal/security", {
      method: "POST",
      body: JSON.stringify({ kind: "rate", key, windowMs, limit }),
    });
  if (!response.ok) fail(503, "Layanan akun sedang sibuk");
  const state = await response.json();
  if (!state.allowed)
    throw Object.assign(
      new Error("Terlalu banyak percobaan. Coba lagi nanti."),
      {
        status: 429,
        retryAfter: state.retryAfter,
      },
    );
}

const cookie = (token, maxAge) =>
  `${SESSION}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
function sessionToken(request) {
  const value = request.headers
    .get("Cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(SESSION + "="))
    ?.slice(SESSION.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
async function startSession(DB, accountId, request) {
  const token = randomHex(32),
    now = Date.now();
  await DB.batch([
    DB.prepare(
      "INSERT INTO api_sessions(token_hash,account_id,created_at,expires_at,user_agent) VALUES(?,?,?,?,?)",
    ).bind(
      await sha256(token),
      accountId,
      now,
      now + SESSION_DAYS * 86400000,
      String(request.headers.get("User-Agent") || "").slice(0, 160),
    ),
    DB.prepare(
      "DELETE FROM api_sessions WHERE account_id=? AND expires_at<?",
    ).bind(accountId, now),
  ]);
  return cookie(token, SESSION_DAYS * 86400);
}
async function currentAccount(request, DB) {
  const token = sessionToken(request);
  if (!token) return null;
  return DB.prepare(
    `SELECT a.id,a.email,a.name,a.created_at,s.token_hash FROM api_sessions s
     JOIN api_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?`,
  )
    .bind(await sha256(token), Date.now())
    .first();
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,189}\.[^\s@]{2,}$/;
function credentials(data, register) {
  const email = typeof data.email === "string" ? data.email.trim() : "";
  const password = typeof data.password === "string" ? data.password : "";
  if (!EMAIL.test(email) || email.length > 254) fail(400, "Email tidak valid");
  if (password.length < 8 || password.length > 256)
    fail(400, "Password minimal 8 karakter");
  if (!register) return { email, password };
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name || name.length > 60) fail(400, "Nama 1–60 karakter");
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password))
    fail(400, "Password harus memuat huruf dan angka");
  return { email, password, name };
}
const keyName = (value) => {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 40) fail(400, "Nama key 1–40 karakter");
  return name;
};

function publicKey(row, monthPlans, bindings) {
  const quota = effectiveLimit(row, bindings),
    limit = quota.monthly + (row.bonus || 0);
  return {
    id: row.id,
    name: row.name,
    preview: `${row.prefix}…${row.last4}`,
    plan: quota.plan,
    planLabel: monthPlans[quota.plan]?.label || quota.plan,
    planExpiresAt: quota.plan === "free" ? null : row.plan_expires_at || null,
    monthlyLimit: quota.monthly,
    bonus: row.bonus || 0,
    limit,
    used: row.used || 0,
    remaining: Math.max(0, limit - (row.used || 0)),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}
async function listKeys(DB, accountId, month, monthPlans, bindings) {
  const { results } = await DB.prepare(
    `SELECT k.*,u.used,u.bonus FROM api_keys k
     LEFT JOIN api_key_usage u ON u.key_id=k.id AND u.period=?
     WHERE k.account_id=? ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC`,
  )
    .bind(month, accountId)
    .all();
  return results.map((row) => publicKey(row, monthPlans, bindings));
}

async function ownedKey(DB, accountId, id) {
  if (typeof id !== "string" || !/^[a-f0-9]{24}$/.test(id))
    fail(404, "API key tidak ditemukan");
  const row = await DB.prepare(
    "SELECT * FROM api_keys WHERE id=? AND account_id=?",
  )
    .bind(id, accountId)
    .first();
  if (!row) fail(404, "API key tidak ditemukan");
  return row;
}

async function usage(DB, accountId, url) {
  const days = Math.min(
    90,
    Math.max(7, Number(url.searchParams.get("days")) || 30),
  );
  const keyFilter = url.searchParams.get("key");
  const now = Date.now(),
    from = day(now - (days - 1) * 86400000);
  const keys =
    keyFilter && /^[a-f0-9]{24}$/.test(keyFilter) ? [keyFilter] : null;
  const scope = keys
    ? "d.key_id=?"
    : "d.key_id IN (SELECT id FROM api_keys WHERE account_id=?)";
  const bind = keys ? keys[0] : accountId;
  if (keys) await ownedKey(DB, accountId, keys[0]);
  const logFrom = Date.now() - Math.min(days, 7) * 86400000;
  const logScope = keys ? "l.key_id=?" : "l.account_id=?";
  const [daily, routes, recent, statuses, hours] = await DB.batch([
    DB.prepare(
      `SELECT d.day,sum(d.requests) AS requests,sum(d.errors) AS errors,sum(d.duration_ms) AS duration
       FROM api_usage_daily d WHERE ${scope} AND d.day>=? GROUP BY d.day ORDER BY d.day`,
    ).bind(bind, from),
    DB.prepare(
      `SELECT d.route,sum(d.requests) AS requests,sum(d.errors) AS errors,sum(d.duration_ms) AS duration
       FROM api_usage_daily d WHERE ${scope} AND d.day>=? GROUP BY d.route ORDER BY requests DESC LIMIT 12`,
    ).bind(bind, from),
    DB.prepare(
      `SELECT l.at,l.method,l.path,l.status,l.duration_ms,k.name AS key_name FROM api_request_log l
       JOIN api_keys k ON k.id=l.key_id WHERE l.account_id=? ${keys ? "AND l.key_id=?" : ""}
       ORDER BY l.at DESC LIMIT 25`,
    ).bind(...(keys ? [accountId, keys[0]] : [accountId])),
    DB.prepare(
      `SELECT l.status,count(*) AS requests FROM api_request_log l WHERE ${logScope} AND l.at>=? GROUP BY l.status ORDER BY requests DESC`,
    ).bind(bind, logFrom),
    // Hour of day in WIB, from the detailed log (kept seven days).
    DB.prepare(
      `SELECT ((l.at/3600000)+7)%24 AS hour,count(*) AS requests FROM api_request_log l WHERE ${logScope} AND l.at>=? GROUP BY hour`,
    ).bind(bind, logFrom),
  ]);
  // Fill missing days with zeros so charts keep a steady time axis.
  const byDay = new Map(daily.results.map((r) => [r.day, r]));
  const series = Array.from({ length: days }, (_, i) => {
    const d = day(now - (days - 1 - i) * 86400000),
      r = byDay.get(d);
    return {
      day: d,
      requests: r?.requests || 0,
      errors: r?.errors || 0,
      avgMs: r?.requests ? Math.round(r.duration / r.requests) : 0,
    };
  });
  const total = series.reduce((a, r) => a + r.requests, 0),
    errors = series.reduce((a, r) => a + r.errors, 0),
    duration = daily.results.reduce((a, r) => a + r.duration, 0);
  return {
    days,
    series,
    totals: {
      requests: total,
      errors,
      errorRate: total ? errors / total : 0,
      avgMs: total ? Math.round(duration / total) : 0,
    },
    routes: routes.results.map((r) => ({
      route: r.route,
      requests: r.requests,
      errors: r.errors,
      avgMs: r.requests ? Math.round(r.duration / r.requests) : 0,
    })),
    statuses: statuses.results.map((r) => ({
      status: r.status,
      requests: r.requests,
    })),
    hours: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      requests:
        hours.results.find((r) => Number(r.hour) === hour)?.requests || 0,
    })),
    recent: recent.results.map((r) => ({
      at: r.at,
      method: r.method,
      path: r.path,
      status: r.status,
      ms: r.duration_ms,
      key: r.key_name,
    })),
  };
}

export async function accountResponse(request, bindings) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/dashboard/api/")) return null;
  const route = url.pathname.slice("/dashboard/api".length);
  try {
    const DB = bindings.DB;
    if (!DB) fail(503, "Database belum siap");
    if (!["GET", "POST", "PUT", "DELETE"].includes(request.method))
      fail(405, "Method tidak diizinkan");
    // State changes only from this site: blocks cross-site form posts.
    if (request.method !== "GET") {
      const origin = request.headers.get("Origin");
      if (origin !== url.origin) fail(403, "Origin tidak diizinkan");
    }
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const monthPlans = plans(bindings),
      month = period();

    if (route === "/config" && request.method === "GET")
      return json({
        plans: Object.entries(monthPlans).map(([id, p]) => ({ id, ...p })),
        maxKeys: maxKeys(bindings),
        required: keysRequired(bindings),
        products: Object.entries(products(bindings)).map(([id, p]) => ({
          id,
          ...p,
        })),
        payments: Boolean(bindings.MYPG_API_KEY),
      });

    if (route === "/register" && request.method === "POST") {
      await limited(bindings, "register:" + ip, 3600000, 5);
      const { email, password, name } = credentials(
        await readBody(request),
        true,
      );
      const id = randomHex(12),
        now = Date.now();
      const created = await DB.prepare(
        "INSERT INTO api_accounts(id,email,name,password_hash,created_at,last_login_at) VALUES(?,?,?,?,?,?) ON CONFLICT(email) DO NOTHING RETURNING id",
      )
        .bind(id, email, name, await hashPassword(password), now, now)
        .first();
      if (!created) fail(409, "Email sudah terdaftar. Silakan masuk.");
      return json({ account: { id, email, name, createdAt: now } }, 201, {
        "Set-Cookie": await startSession(DB, id, request),
      });
    }

    if (route === "/login" && request.method === "POST") {
      await limited(bindings, "login:" + ip, 900000, 10);
      const { email, password } = credentials(await readBody(request), false);
      const account = await DB.prepare(
        "SELECT id,email,name,password_hash,created_at FROM api_accounts WHERE email=?",
      )
        .bind(email)
        .first();
      const valid = await verifyPassword(
        password,
        account?.password_hash || DECOY,
      );
      if (!account || !valid) fail(401, "Email atau password salah");
      await DB.prepare("UPDATE api_accounts SET last_login_at=? WHERE id=?")
        .bind(Date.now(), account.id)
        .run();
      return json(
        {
          account: {
            id: account.id,
            email: account.email,
            name: account.name,
            createdAt: account.created_at,
          },
        },
        200,
        { "Set-Cookie": await startSession(DB, account.id, request) },
      );
    }

    if (route === "/fanbases" && request.method === "GET")
      return json({ fanbases: await listedFanbases(DB) }, 200, {
        "Cache-Control": "public, max-age=300",
      });

    const account = await currentAccount(request, DB);
    if (route === "/session" && request.method === "GET")
      return json({
        account: account
          ? {
              id: account.id,
              email: account.email,
              name: account.name,
              createdAt: account.created_at,
            }
          : null,
      });
    if (!account) fail(401, "Silakan masuk terlebih dahulu");

    if (route === "/logout" && request.method === "POST") {
      await DB.prepare("DELETE FROM api_sessions WHERE token_hash=?")
        .bind(account.token_hash)
        .run();
      return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
    }

    if (route === "/password" && request.method === "PUT") {
      await limited(bindings, "password:" + account.id, 900000, 5);
      const data = await readBody(request);
      const row = await DB.prepare(
        "SELECT password_hash FROM api_accounts WHERE id=?",
      )
        .bind(account.id)
        .first();
      if (
        !(await verifyPassword(String(data.current || ""), row.password_hash))
      )
        fail(401, "Password saat ini salah");
      const { password } = credentials(
        { email: account.email, password: data.password, name: account.name },
        true,
      );
      // A new password signs out every other device.
      await DB.batch([
        DB.prepare("UPDATE api_accounts SET password_hash=? WHERE id=?").bind(
          await hashPassword(password),
          account.id,
        ),
        DB.prepare(
          "DELETE FROM api_sessions WHERE account_id=? AND token_hash<>?",
        ).bind(account.id, account.token_hash),
      ]);
      return json({ ok: true });
    }

    if (route === "/overview" && request.method === "GET") {
      const keys = await listKeys(DB, account.id, month, monthPlans, bindings);
      const active = keys.filter((k) => !k.revokedAt);
      return json({
        period: month,
        resetsAt: resetsAt(),
        quota: {
          used: active.reduce((a, k) => a + k.used, 0),
          limit: active.reduce((a, k) => a + k.limit, 0),
        },
        keys,
        usage: await usage(DB, account.id, new URL("?days=30", url)),
      });
    }

    if (route === "/keys" && request.method === "GET")
      return json({
        period: month,
        resetsAt: resetsAt(),
        maxKeys: maxKeys(bindings),
        keys: await listKeys(DB, account.id, month, monthPlans, bindings),
      });

    if (route === "/keys" && request.method === "POST") {
      const name = keyName((await readBody(request)).name);
      const { count } = await DB.prepare(
        "SELECT count(*) AS count FROM api_keys WHERE account_id=? AND revoked_at IS NULL",
      )
        .bind(account.id)
        .first();
      if (count >= maxKeys(bindings))
        fail(409, `Maksimal ${maxKeys(bindings)} API key aktif per akun`);
      const { key, prefix, last4 } = newKey(),
        id = randomHex(12),
        now = Date.now();
      await DB.prepare(
        "INSERT INTO api_keys(id,account_id,name,prefix,last4,key_hash,plan,monthly_limit,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
        .bind(
          id,
          account.id,
          name,
          prefix,
          last4,
          await sha256(key),
          "free",
          monthPlans.free.monthly,
          now,
        )
        .run();
      return json(
        {
          key,
          item: publicKey(
            {
              id,
              name,
              prefix,
              last4,
              plan: "free",
              monthly_limit: monthPlans.free.monthly,
              created_at: now,
            },
            monthPlans,
            bindings,
          ),
        },
        201,
      );
    }

    const keyRoute = route.match(/^\/keys\/([a-f0-9]{24})$/);
    if (keyRoute && request.method === "PUT") {
      const row = await ownedKey(DB, account.id, keyRoute[1]);
      if (row.revoked_at) fail(409, "Key yang dicabut tidak bisa diubah");
      const name = keyName((await readBody(request)).name);
      await DB.prepare("UPDATE api_keys SET name=? WHERE id=?")
        .bind(name, row.id)
        .run();
      return json({ ok: true });
    }
    if (keyRoute && request.method === "DELETE") {
      const row = await ownedKey(DB, account.id, keyRoute[1]);
      await DB.prepare(
        "UPDATE api_keys SET revoked_at=? WHERE id=? AND revoked_at IS NULL",
      )
        .bind(Date.now(), row.id)
        .run();
      forgetKey(row.key_hash);
      return json({ ok: true });
    }

    if (route === "/usage" && request.method === "GET")
      return json(await usage(DB, account.id, url));

    if (route === "/topup" && request.method === "POST") {
      await limited(bindings, "topup:" + account.id, 3600000, 10);
      const data = await readBody(request);
      const row = await ownedKey(DB, account.id, data.keyId);
      if (row.revoked_at) fail(409, "Pilih API key yang masih aktif");
      const code = normalizeVoucher(data.code);
      if (!/^[A-Z0-9]{12}$/.test(code))
        fail(400, "Format kode voucher tidak valid");
      const now = Date.now(),
        hash = await sha256("voucher:" + code);
      // Redeem and credit atomically: the credit reads the voucher this
      // batch just claimed, so a code can never be spent twice.
      const [claimed] = await DB.batch([
        DB.prepare(
          "UPDATE api_vouchers SET redeemed_at=?,redeemed_by=?,redeemed_key=? WHERE code_hash=? AND redeemed_at IS NULL RETURNING requests",
        ).bind(now, account.id, row.id, hash),
        DB.prepare(
          `INSERT INTO api_key_usage(key_id,period,used,bonus)
           SELECT ?1,?2,0,requests FROM api_vouchers WHERE code_hash=?3 AND redeemed_at=?4 AND redeemed_key=?1
           ON CONFLICT(key_id,period) DO UPDATE SET bonus=bonus+excluded.bonus`,
        ).bind(row.id, month, hash, now),
        DB.prepare(
          `INSERT INTO api_topups(account_id,key_id,period,requests,source,created_at)
           SELECT ?1,?2,?3,requests,'voucher',?4 FROM api_vouchers WHERE code_hash=?5 AND redeemed_at=?4 AND redeemed_key=?2`,
        ).bind(account.id, row.id, month, now, hash),
      ]);
      const requests = claimed.results?.[0]?.requests;
      if (!requests)
        fail(404, "Kode voucher tidak ditemukan atau sudah dipakai");
      return json({ ok: true, requests, period: month });
    }

    if (route === "/topups" && request.method === "GET") {
      const { results } = await DB.prepare(
        `SELECT t.created_at,t.period,t.requests,t.source,k.name AS key_name FROM api_topups t
         JOIN api_keys k ON k.id=t.key_id WHERE t.account_id=? ORDER BY t.created_at DESC LIMIT 50`,
      )
        .bind(account.id)
        .all();
      return json({
        topups: results.map((r) => ({
          at: r.created_at,
          period: r.period,
          requests: r.requests,
          source: r.source,
          key: r.key_name,
        })),
      });
    }

    if (route === "/fanbase" && request.method === "GET")
      return json({
        application: await latestApplication(DB, account.id),
        follow: followHandle(bindings),
        monthly: monthPlans.fanbase.monthly,
      });
    if (route === "/fanbase" && request.method === "POST") {
      await limited(bindings, "fanbase:" + account.id, 86400000, 3);
      const data = await readBody(request);
      const form = readApplication(data);
      const key = await ownedKey(DB, account.id, data.keyId);
      if (key.revoked_at) fail(409, "Pilih API key yang masih aktif");
      return json(
        { application: await submitApplication(DB, account, key, form) },
        201,
      );
    }

    if (route === "/profile" && request.method === "PUT") {
      const name = String((await readBody(request)).name || "").trim();
      if (!name || name.length > 60) fail(400, "Nama 1–60 karakter");
      await DB.prepare("UPDATE api_accounts SET name=? WHERE id=?")
        .bind(name, account.id)
        .run();
      return json({ ok: true, name });
    }

    if (route === "/sessions" && request.method === "GET") {
      const { results } = await DB.prepare(
        "SELECT token_hash,created_at,expires_at,user_agent FROM api_sessions WHERE account_id=? AND expires_at>? ORDER BY created_at DESC LIMIT 20",
      )
        .bind(account.id, Date.now())
        .all();
      return json({
        sessions: results.map((r) => ({
          id: r.token_hash.slice(0, 16),
          current: r.token_hash === account.token_hash,
          createdAt: r.created_at,
          expiresAt: r.expires_at,
          userAgent: r.user_agent,
        })),
      });
    }
    const sessionRoute = route.match(/^\/sessions\/([a-f0-9]{16})$/);
    if (sessionRoute && request.method === "DELETE") {
      await DB.prepare(
        "DELETE FROM api_sessions WHERE account_id=? AND substr(token_hash,1,16)=? AND token_hash<>?",
      )
        .bind(account.id, sessionRoute[1], account.token_hash)
        .run();
      return json({ ok: true });
    }
    if (route === "/sessions" && request.method === "DELETE") {
      await DB.prepare(
        "DELETE FROM api_sessions WHERE account_id=? AND token_hash<>?",
      )
        .bind(account.id, account.token_hash)
        .run();
      return json({ ok: true });
    }

    if (route === "/account" && request.method === "DELETE") {
      await limited(bindings, "delete:" + account.id, 900000, 5);
      const data = await readBody(request);
      const row = await DB.prepare(
        "SELECT password_hash FROM api_accounts WHERE id=?",
      )
        .bind(account.id)
        .first();
      if (
        !(await verifyPassword(String(data.password || ""), row.password_hash))
      )
        fail(401, "Password salah");
      const { results: keys } = await DB.prepare(
        "SELECT key_hash FROM api_keys WHERE account_id=?",
      )
        .bind(account.id)
        .all();
      // Keys are revoked rather than erased so usage history stays consistent.
      await DB.batch([
        DB.prepare(
          "UPDATE api_keys SET revoked_at=coalesce(revoked_at,?) WHERE account_id=?",
        ).bind(Date.now(), account.id),
        DB.prepare("DELETE FROM api_sessions WHERE account_id=?").bind(
          account.id,
        ),
        DB.prepare("DELETE FROM api_request_log WHERE account_id=?").bind(
          account.id,
        ),
        // A deleted account leaves the public fanbase roll too.
        DB.prepare(
          "UPDATE api_fanbase_applications SET listing=0 WHERE account_id=?",
        ).bind(account.id),
        DB.prepare("DELETE FROM api_accounts WHERE id=?").bind(account.id),
      ]);
      keys.forEach((k) => forgetKey(k.key_hash));
      return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
    }

    if (route === "/logs" && request.method === "GET") {
      const status = url.searchParams.get("status"),
        keyId = url.searchParams.get("key"),
        before = Number(url.searchParams.get("before")) || 0;
      if (keyId) await ownedKey(DB, account.id, keyId);
      const ranges = {
        "2xx": [200, 299],
        "4xx": [400, 499],
        "5xx": [500, 599],
        429: [429, 429],
      };
      const range = ranges[status];
      const where = ["l.account_id=?"],
        params = [account.id];
      const add = (clause, ...values) => {
        where.push(clause);
        params.push(...values);
      };
      if (keyId) add("l.key_id=?", keyId);
      if (range) add("l.status BETWEEN ? AND ?", ...range);
      if (before) add("l.id<?", before);
      const { results } = await DB.prepare(
        `SELECT l.id,l.at,l.method,l.path,l.status,l.duration_ms,k.name AS key_name FROM api_request_log l
         JOIN api_keys k ON k.id=l.key_id WHERE ${where.join(" AND ")} ORDER BY l.id DESC LIMIT 50`,
      )
        .bind(...params)
        .all();
      return json({
        logs: results.map((r) => ({
          id: r.id,
          at: r.at,
          method: r.method,
          path: r.path,
          status: r.status,
          ms: r.duration_ms,
          key: r.key_name,
        })),
        next: results.length === 50 ? results.at(-1).id : null,
      });
    }

    const catalog = products(bindings);
    const paymentsOf = async () =>
      (
        await DB.prepare(
          `SELECT p.*,k.name AS key_name FROM api_payments p JOIN api_keys k ON k.id=p.key_id
           WHERE p.account_id=? ORDER BY p.created_at DESC LIMIT 30`,
        )
          .bind(account.id)
          .all()
      ).results;
    if (route === "/billing" && request.method === "GET") {
      let rows = await paymentsOf();
      // Opening billing settles orders that were paid while nobody watched.
      const pending = rows.filter((r) => r.status === "PENDING").slice(0, 3);
      if (pending.length && bindings.MYPG_API_KEY) {
        for (const row of pending)
          await refreshPayment(bindings, row).catch(() => null);
        rows = await paymentsOf();
      }
      return json({
        enabled: Boolean(bindings.MYPG_API_KEY),
        products: Object.entries(catalog).map(([id, p]) => ({ id, ...p })),
        payments: rows.map((r) => publicPayment(r, catalog)),
      });
    }
    if (route === "/payments" && request.method === "POST") {
      await limited(bindings, "payment:" + account.id, 3600000, 10);
      const data = await readBody(request);
      const key = await ownedKey(DB, account.id, data.keyId);
      if (key.revoked_at) fail(409, "Pilih API key yang masih aktif");
      return json(
        { payment: await createPayment(bindings, account, key, data.product) },
        201,
      );
    }
    const paymentRoute = route.match(
      /^\/payments\/(JKC[A-F0-9]{16})(\/cancel)?$/,
    );
    if (paymentRoute) {
      const row = await DB.prepare(
        `SELECT p.*,k.name AS key_name FROM api_payments p JOIN api_keys k ON k.id=p.key_id
         WHERE p.id=? AND p.account_id=?`,
      )
        .bind(paymentRoute[1], account.id)
        .first();
      if (!row) fail(404, "Tagihan tidak ditemukan");
      if (!paymentRoute[2] && request.method === "GET")
        return json({
          payment: publicPayment(await refreshPayment(bindings, row), catalog),
        });
      if (paymentRoute[2] && request.method === "POST")
        return json({
          payment: publicPayment(await cancelPayment(bindings, row), catalog),
        });
    }

    fail(404, "Endpoint tidak ditemukan");
  } catch (error) {
    const status = error.status || 500;
    if (status === 500)
      console.error({ event: "dashboard-api-failed", message: error.message });
    return json(
      {
        message:
          status === 500 ? "Terjadi kesalahan. Coba lagi." : error.message,
      },
      status,
      error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {},
    );
  }
}

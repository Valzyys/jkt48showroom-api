import {
  day,
  keysRequired,
  effectiveLimit,
  looksLikeKey,
  period,
  resetsAt,
  routeOf,
  sha256,
} from "./core.js";

// Every /api request outside the app's own session routes spends one request
// of the caller's monthly quota. The first-party app keeps working through its
// signed requests, the server key, or an explicitly exempt origin.
const EXEMPT = /^\/api\/(stream|beta|auth|user|showroom|admin|profile)(\/|$)/;
export const isMetered = (pathname, method) =>
  method !== "OPTIONS" &&
  pathname.startsWith("/api/") &&
  !EXEMPT.test(pathname);

const DASHBOARD = "/dashboard/keys";
const GUIDE = "/docs/guide/autentikasi-dan-integrasi";

// Key rows are cached briefly per isolate; usage is always counted in D1.
const cache = new Map();
const TTL = 30000;
export function forgetKey(hash) {
  if (hash) cache.delete(hash);
  else cache.clear();
}
async function lookup(DB, hash, now) {
  const hit = cache.get(hash);
  if (hit && now - hit.at < TTL) return hit.row;
  const row = await DB.prepare(
    "SELECT id,account_id,plan,monthly_limit,plan_expires_at,revoked_at FROM api_keys WHERE key_hash=?",
  )
    .bind(hash)
    .first();
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  cache.set(hash, { row, at: now });
  return row;
}

const list = (value) =>
  String(value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

async function firstParty(request, bindings, verify) {
  const origin = request.headers.get("Origin");
  if (origin && list(bindings.API_KEY_EXEMPT_ORIGINS).includes(origin))
    return true;
  const signature = request.headers.get("X-Signature"),
    nonce = request.headers.get("X-Nonce"),
    timestamp = Number(request.headers.get("X-Timestamp"));
  if (
    !signature ||
    !nonce ||
    nonce.length > 256 ||
    !Number.isSafeInteger(timestamp)
  )
    return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 240) return false;
  try {
    return (
      Boolean(verify.signature) &&
      (await verify.signature(
        `${nonce}.${timestamp}`,
        signature,
        request.headers.get("X-Source"),
      ))
    );
  } catch {
    return false;
  }
}

function deny(request, status, message, extra = {}, headers = {}) {
  const url = new URL(request.url);
  return Response.json(
    {
      status,
      message,
      ...extra,
      dashboard: url.origin + DASHBOARD,
      docs: url.origin + GUIDE,
      path: url.pathname,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...headers,
      },
    },
  );
}

const pass = (client = null) => ({ client, finish: (response) => response });

// `verify` carries the app's own JWT and request-signature checks, passed in
// by the Worker so this module stays free of its runtime aliases.
export async function meter(request, bindings, execution, verify = {}) {
  const url = new URL(request.url);
  if (!isMetered(url.pathname, request.method)) return pass();
  const token =
    request.headers.get("X-API-Key") || url.searchParams.get("api_key") || "";
  const required = keysRequired(bindings);
  if (bindings.API_KEY && token === bindings.API_KEY)
    return pass({ kind: "server" });
  if (!looksLikeKey(token)) {
    if (
      token &&
      bindings.JWT_SECRET &&
      verify.jwt?.(token, bindings.JWT_SECRET)
    )
      return pass({ kind: "app" });
    if (await firstParty(request, bindings, verify))
      return pass({ kind: "app" });
    // Without enforcement, unknown values stay with the route (e.g. weekly).
    if (!required) return pass();
    return {
      response: deny(
        request,
        401,
        token
          ? "API key tidak valid. Gunakan key jkc_… dari dashboard."
          : "API key diperlukan. Buat API key gratis di dashboard lalu kirim lewat header X-API-Key.",
      ),
    };
  }
  if (!bindings.DB)
    return { response: deny(request, 503, "Layanan API key belum siap.") };
  const now = Date.now(),
    hash = await sha256(token),
    key = await lookup(bindings.DB, hash, now);
  if (!key) return { response: deny(request, 401, "API key tidak dikenal.") };
  if (key.revoked_at)
    return { response: deny(request, 401, "API key ini sudah dicabut.") };
  const month = period(now),
    reset = resetsAt(now),
    quota = effectiveLimit(key, bindings, now);
  // One statement counts and enforces: the update only happens under quota.
  const row = await bindings.DB.prepare(
    `INSERT INTO api_key_usage(key_id,period,used,bonus) VALUES(?1,?2,1,0)
     ON CONFLICT(key_id,period) DO UPDATE SET used=used+1
     WHERE api_key_usage.used < ?3 + api_key_usage.bonus
     RETURNING used,bonus`,
  )
    .bind(key.id, month, quota.monthly)
    .first();
  const route = routeOf(request.method, url.pathname);
  const log = (status, started, extra = []) =>
    execution?.waitUntil(
      bindings.DB.batch([
        bindings.DB.prepare(
          "INSERT INTO api_request_log(account_id,key_id,at,method,path,status,duration_ms) VALUES(?,?,?,?,?,?,?)",
        ).bind(
          key.account_id,
          key.id,
          now,
          request.method,
          url.pathname.slice(0, 200),
          status,
          Math.max(0, Date.now() - started),
        ),
        ...extra,
        ...(Math.random() < 0.01
          ? [
              bindings.DB.prepare(
                "DELETE FROM api_request_log WHERE at < ?",
              ).bind(now - 7 * 86400000),
            ]
          : []),
      ]).catch((error) =>
        console.error({
          event: "api-usage-log-failed",
          message: error.message,
        }),
      ),
    );
  if (!row) {
    const usage = await bindings.DB.prepare(
      "SELECT used,bonus FROM api_key_usage WHERE key_id=? AND period=?",
    )
      .bind(key.id, month)
      .first();
    const limit = quota.monthly + (usage?.bonus || 0);
    log(429, now);
    return {
      response: deny(
        request,
        429,
        "Kuota bulanan API key ini habis. Isi ulang di dashboard atau tunggu reset awal bulan.",
        {
          limit,
          used: usage?.used ?? limit,
          resets_at: new Date(reset).toISOString(),
        },
        {
          "Retry-After": String(Math.ceil((reset - now) / 1000)),
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.floor(reset / 1000)),
        },
      ),
    };
  }
  const limit = quota.monthly + row.bonus;
  const client = {
    kind: "key",
    id: key.id,
    account: key.account_id,
    plan: quota.plan,
    limit,
    used: row.used,
  };
  return {
    client,
    finish(response) {
      const status = response.status;
      const elapsed = Math.max(0, Date.now() - now);
      log(status, now, [
        bindings.DB.prepare(
          `INSERT INTO api_usage_daily(key_id,day,route,requests,errors,duration_ms) VALUES(?,?,?,1,?,?)
           ON CONFLICT(key_id,day,route) DO UPDATE SET requests=requests+1,errors=errors+excluded.errors,duration_ms=duration_ms+excluded.duration_ms`,
        ).bind(key.id, day(now), route, status >= 400 ? 1 : 0, elapsed),
        bindings.DB.prepare(
          "UPDATE api_keys SET last_used_at=?1 WHERE id=?2 AND (last_used_at IS NULL OR last_used_at < ?1 - 60000)",
        ).bind(now, key.id),
      ]);
      if (status === 101) return response;
      const headers = new Headers(response.headers);
      headers.set("X-RateLimit-Limit", String(limit));
      headers.set(
        "X-RateLimit-Remaining",
        String(Math.max(0, limit - row.used)),
      );
      headers.set("X-RateLimit-Reset", String(Math.floor(reset / 1000)));
      headers.set("X-Quota-Period", month);
      return new Response(response.body, {
        status,
        statusText: response.statusText,
        headers,
      });
    },
  };
}

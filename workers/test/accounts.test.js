import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { accountResponse } from "../src/accounts/index.js";
import { meter, isMetered, forgetKey } from "../src/accounts/metering.js";
import { developerAdmin } from "../src/accounts/admin.js";
import {
  effectiveLimit,
  period,
  resetsAt,
  routeOf,
  products,
  normalizeVoucher,
} from "../src/accounts/core.js";

// D1 stand-in on node:sqlite with the real migrations, batch transactions
// and RETURNING, so the SQL here is the SQL that runs in production.
function d1() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../migrations/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sqlite.exec(
      readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"),
    );
  const prepare = (sql) => {
    let values = [];
    const statement = {
      bind(...args) {
        values = args.map((v) => (v === undefined ? null : v));
        return statement;
      },
      first: async () => sqlite.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
      run: async () => {
        sqlite.prepare(sql).run(...values);
        return { success: true };
      },
      exec: () => ({ results: sqlite.prepare(sql).all(...values) }),
    };
    return statement;
  };
  return {
    sqlite,
    prepare,
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((s) => s.exec());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

const ORIGIN = "https://api.test";
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  forgetKey();
});

function client(bindings) {
  let cookie = "",
    csrf = "";
  const call = async (method, path, body, headers = {}) => {
    const response = await accountResponse(
      new Request(ORIGIN + "/dashboard/api" + path, {
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(method !== "GET"
            ? {
                Origin: ORIGIN,
                "X-Requested-With": "jkt48connect",
                ...(csrf ? { "X-CSRF-Token": csrf } : {}),
              }
            : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          "User-Agent": "test-agent",
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      bindings,
    );
    const set = response.headers.get("Set-Cookie");
    if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    const data = await response.json();
    if (typeof data.csrf === "string") csrf = data.csrf;
    return { status: response.status, data, set };
  };
  return { call, cookie: () => cookie, csrf: () => csrf };
}

async function signedUp(bindings, email = "dev@example.test") {
  const c = client(bindings);
  const r = await c.call("POST", "/register", {
    name: "Dev",
    email,
    password: "rahasia123",
  });
  assert.equal(r.status, 201);
  return c;
}

const work = () => {
  const jobs = [];
  return { waitUntil: (p) => jobs.push(p), settle: () => Promise.all(jobs) };
};
const apiRequest = (path, headers = {}) =>
  new Request(ORIGIN + path, { headers });

test("accounts register, sign in with a hashed session cookie, and sign out", async () => {
  const bindings = { DB: d1() };
  const c = client(bindings);
  assert.equal((await c.call("GET", "/session")).data.account, null);
  const weak = await c.call("POST", "/register", {
    name: "Dev",
    email: "dev@example.test",
    password: "short",
  });
  assert.equal(weak.status, 400);
  const created = await c.call("POST", "/register", {
    name: "Dev",
    email: "Dev@Example.test",
    password: "rahasia123",
  });
  assert.equal(created.status, 201);
  assert.match(
    created.set,
    /^__Host-jkc_session=[a-f0-9]{64}; HttpOnly; Secure; SameSite=Lax; Path=\//,
  );
  // Only the token hash is stored, never the cookie value itself.
  const token = c.cookie().split("=")[1];
  const stored = bindings.DB.sqlite
    .prepare("SELECT token_hash,user_agent FROM api_sessions")
    .get();
  assert.notEqual(stored.token_hash, token);
  assert.equal(stored.user_agent, "test-agent");
  assert.equal(
    (await c.call("GET", "/session")).data.account.email,
    "Dev@Example.test",
  );
  const hash = bindings.DB.sqlite
    .prepare("SELECT password_hash FROM api_accounts")
    .get().password_hash;
  assert.match(hash, /^pbkdf2-sha256\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}$/);

  const again = client(bindings);
  assert.equal(
    (
      await again.call("POST", "/register", {
        name: "X",
        email: "dev@example.test",
        password: "rahasia123",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await again.call("POST", "/login", {
        email: "dev@example.test",
        password: "salah1234",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await again.call("POST", "/login", {
        email: "nobody@example.test",
        password: "rahasia123",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await again.call("POST", "/login", {
        email: "dev@example.test",
        password: "rahasia123",
      })
    ).status,
    200,
  );
  assert.equal((await again.call("GET", "/sessions")).data.sessions.length, 2);
  assert.equal((await again.call("DELETE", "/sessions")).status, 200);
  assert.equal((await c.call("GET", "/keys")).status, 401);
  assert.equal((await again.call("POST", "/logout", {})).status, 200);
  assert.equal((await again.call("GET", "/keys")).status, 401);
});

test("state changes need this origin and JSON", async () => {
  const bindings = { DB: d1() };
  const c = await signedUp(bindings);
  assert.equal(
    (
      await c.call(
        "POST",
        "/keys",
        { name: "x" },
        { Origin: "https://evil.test" },
      )
    ).status,
    403,
  );
  const plain = await accountResponse(
    new Request(ORIGIN + "/dashboard/api/login", {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        "X-Requested-With": "jkt48connect",
        "Content-Type": "text/plain",
      },
      body: "{}",
    }),
    bindings,
  );
  assert.equal(plain.status, 415);
  assert.equal(
    await accountResponse(new Request(ORIGIN + "/docs"), bindings),
    null,
  );
});

test("keys are shown once, stored hashed, limited per account, renamed and revoked", async () => {
  const bindings = { DB: d1(), API_MAX_KEYS: "2" };
  const c = await signedUp(bindings);
  const made = await c.call("POST", "/keys", { name: "Bot Discord" });
  assert.equal(made.status, 201);
  assert.match(made.data.key, /^jkc_[a-f0-9]{40}$/);
  assert.equal(
    made.data.item.preview,
    made.data.key.slice(0, 10) + "…" + made.data.key.slice(-4),
  );
  assert.equal(made.data.item.limit, 1000);
  const row = bindings.DB.sqlite.prepare("SELECT key_hash FROM api_keys").get();
  assert.ok(!JSON.stringify(row).includes(made.data.key.slice(4)));
  await c.call("POST", "/keys", { name: "Web" });
  assert.equal(
    (await c.call("POST", "/keys", { name: "Satu lagi" })).status,
    409,
  );
  const list = (await c.call("GET", "/keys")).data.keys;
  assert.equal(list.length, 2);
  assert.ok(list.every((k) => !("key" in k)));
  assert.equal(
    (await c.call("PUT", "/keys/" + made.data.item.id, { name: "Bot" })).status,
    200,
  );
  assert.equal(
    (await c.call("DELETE", "/keys/" + made.data.item.id)).status,
    200,
  );
  // Another account cannot touch these keys.
  const other = await signedUp(bindings, "other@example.test");
  assert.equal((await other.call("DELETE", "/keys/" + list[0].id)).status, 404);
});

test("metering enforces keys, counts the monthly quota, and records analytics", async () => {
  const DB = d1();
  const bindings = {
    DB,
    API_KEY_REQUIRED: "true",
    API_FREE_MONTHLY_LIMIT: "3",
    API_KEY: "server-key",
    JWT_SECRET: "s",
    API_KEY_EXEMPT_ORIGINS: "https://jkt48connect.com",
  };
  const c = await signedUp(bindings);
  const { key } = (await c.call("POST", "/keys", { name: "Bot" })).data;
  assert.ok(isMetered("/api/news", "GET"));
  for (const path of [
    "/api/stream",
    "/api/auth/login",
    "/api/admin/x",
    "/api/beta",
    "/docs",
  ])
    assert.ok(!isMetered(path, "GET"), path);
  assert.ok(!isMetered("/api/news", "OPTIONS"));

  const missing = await meter(apiRequest("/api/news"), bindings, work());
  assert.equal(missing.response.status, 401);
  assert.match((await missing.response.json()).dashboard, /\/dashboard\/keys$/);
  assert.equal(
    (
      await meter(
        apiRequest("/api/news", { "X-API-Key": "jkc_" + "0".repeat(40) }),
        bindings,
        work(),
      )
    ).response.status,
    401,
  );
  assert.equal(
    (
      await meter(
        apiRequest("/api/news", { "X-API-Key": "server-key" }),
        bindings,
        work(),
      )
    ).client.kind,
    "server",
  );
  assert.equal(
    (
      await meter(
        apiRequest("/api/news", { Origin: "https://jkt48connect.com" }),
        bindings,
        work(),
      )
    ).client.kind,
    "app",
  );
  assert.equal(
    (
      await meter(
        apiRequest("/api/news", { "X-API-Key": "app-jwt" }),
        bindings,
        work(),
        { jwt: (t) => t === "app-jwt" },
      )
    ).client.kind,
    "app",
  );
  // Without enforcement, unknown values are left to the route.
  assert.equal(
    (await meter(apiRequest("/api/weekly?api_key=x"), { DB }, work())).response,
    undefined,
  );

  const jobs = work();
  for (let i = 1; i <= 3; i++) {
    const m = await meter(
      apiRequest("/api/news/12" + i + "?api_key=" + key),
      bindings,
      jobs,
    );
    assert.equal(m.client.kind, "key");
    assert.equal(m.client.used, i);
    const response = m.finish(
      new Response("{}", { status: i === 3 ? 404 : 200 }),
    );
    assert.equal(response.headers.get("X-RateLimit-Limit"), "3");
    assert.equal(response.headers.get("X-RateLimit-Remaining"), String(3 - i));
    assert.equal(response.headers.get("X-Quota-Period"), period());
  }
  const over = await meter(
    apiRequest("/api/news", { "X-API-Key": key }),
    bindings,
    jobs,
  );
  assert.equal(over.response.status, 429);
  assert.ok(Number(over.response.headers.get("Retry-After")) > 0);
  assert.equal((await over.response.json()).used, 3);
  await jobs.settle();

  const usage = (await c.call("GET", "/usage?days=7")).data;
  assert.equal(usage.series.length, 7);
  assert.equal(usage.totals.requests, 3);
  assert.equal(usage.totals.errors, 1);
  assert.deepEqual(
    usage.routes.map((r) => [r.route, r.requests]),
    [["GET /api/news/:id", 3]],
  );
  assert.equal(usage.statuses.find((s) => s.status === 429).requests, 1);
  assert.equal(
    usage.hours.reduce((a, h) => a + h.requests, 0),
    4,
  );
  // Logged paths never keep the query string, where keys may travel.
  assert.ok(usage.recent.every((r) => !r.path.includes("?")));
  assert.equal((await c.call("GET", "/logs?status=429")).data.logs.length, 1);
  assert.equal((await c.call("GET", "/logs?status=2xx")).data.logs.length, 2);
  const overview = (await c.call("GET", "/overview")).data;
  assert.deepEqual(overview.quota, { used: 3, limit: 3 });

  const id = overview.keys[0].id;
  await c.call("DELETE", "/keys/" + id);
  assert.equal(
    (
      await meter(
        apiRequest("/api/news", { "X-API-Key": key }),
        bindings,
        work(),
      )
    ).response.status,
    401,
  );
});

test("vouchers from the control panel top up a key exactly once", async () => {
  const DB = d1();
  const bindings = {
    DB,
    API_KEY_REQUIRED: "true",
    API_FREE_MONTHLY_LIMIT: "1",
  };
  const c = await signedUp(bindings);
  const { key, item } = (await c.call("POST", "/keys", { name: "Bot" })).data;
  const body = async (request) => request.json();
  const minted = await developerAdmin(
    new URL(ORIGIN + "/control/api/developers/vouchers"),
    new Request(ORIGIN, {
      method: "POST",
      body: JSON.stringify({ requests: 5, count: 2, note: "promo" }),
    }),
    bindings,
    body,
  );
  assert.equal(minted.codes.length, 2);
  assert.match(minted.codes[0], /^JKC-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(normalizeVoucher(minted.codes[0].toLowerCase()).length, 12);
  const redeemed = await c.call("POST", "/topup", {
    code: minted.codes[0].toLowerCase(),
    keyId: item.id,
  });
  assert.equal(redeemed.status, 200);
  assert.equal(redeemed.data.requests, 5);
  assert.equal(
    (await c.call("POST", "/topup", { code: minted.codes[0], keyId: item.id }))
      .status,
    404,
  );
  const keys = (await c.call("GET", "/keys")).data.keys;
  assert.equal(keys[0].limit, 6);
  assert.equal(keys[0].bonus, 5);
  assert.equal((await c.call("GET", "/topups")).data.topups[0].requests, 5);
  for (let i = 0; i < 6; i++)
    assert.ok(
      (
        await meter(
          apiRequest("/api/news", { "X-API-Key": key }),
          bindings,
          work(),
        )
      ).client,
    );
  assert.equal(
    (
      await meter(
        apiRequest("/api/news", { "X-API-Key": key }),
        bindings,
        work(),
      )
    ).response.status,
    429,
  );

  const admin = await developerAdmin(
    new URL(ORIGIN + "/control/api/developers"),
    new Request(ORIGIN),
    bindings,
    body,
  );
  assert.equal(admin.totals.accounts, 1);
  assert.equal(admin.accounts[0].keys[0].used, 6);
  await developerAdmin(
    new URL(ORIGIN + "/control/api/developers/keys/" + item.id),
    new Request(ORIGIN, {
      method: "PUT",
      body: JSON.stringify({ plan: "pro" }),
    }),
    bindings,
    body,
  );
  assert.equal(
    (await c.call("GET", "/keys")).data.keys[0].monthlyLimit,
    150000,
  );
});

test("MYPG payments buy plans and top-ups once, only for the full amount", async () => {
  const DB = d1();
  const bindings = { DB, MYPG_API_KEY: "mypg-secret" };
  const c = await signedUp(bindings);
  const { item } = (await c.call("POST", "/keys", { name: "Bot" })).data;
  const calls = [];
  let state = { status: "PENDING", amount: 15037 };
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://yobasepay.net/qr_render"))
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { "Content-Type": "image/png" },
      });
    const body = new URLSearchParams(init.body);
    calls.push({ url: String(url), body: Object.fromEntries(body) });
    const action = new URL(url).searchParams.get("action");
    if (action === "createpayment")
      return Response.json({
        status: true,
        data: {
          trx_id: "MY-" + calls.length,
          payment_token: "t",
          amount: Number(body.get("amount")) + 37,
          qr_image: "https://yobasepay.net/qr_render?payload=x",
          payment_url: "https://evil.test/pay",
          expired_at: "2026-10-15 17:36:38",
        },
      });
    if (action === "checkstatus")
      return Response.json({
        status: true,
        data: { trx_id: body.get("trxid"), ...state },
      });
    if (action === "cancelpayment")
      return Response.json({
        status: true,
        data: { status: "CANCELLED", trx_id: body.get("trxid") },
      });
  };
  assert.equal(
    (await c.call("POST", "/payments", { product: "nope", keyId: item.id }))
      .status,
    400,
  );
  const made = await c.call("POST", "/payments", {
    product: "starter-30d",
    keyId: item.id,
  });
  assert.equal(made.status, 201);
  const pay = made.data.payment;
  assert.equal(pay.amount, 15037);
  // The QR is always served from our own origin.
  assert.equal(pay.qrImage, "/dashboard/api/payments/" + pay.id + "/qr");
  assert.equal(pay.paymentUrl, null, "foreign pay links are dropped");
  // The project key travels in the body only.
  assert.equal(calls[0].body.api_key, "mypg-secret");
  assert.equal(calls[0].body.amount, "15000");
  assert.equal(calls[0].body.ref_id, pay.id);
  assert.ok(!calls[0].url.includes("mypg-secret"));

  assert.equal(
    (await c.call("GET", "/payments/" + pay.id)).data.payment.status,
    "PENDING",
  );
  const qr = await accountResponse(
    new Request(ORIGIN + pay.qrImage, { headers: { Cookie: c.cookie() } }),
    bindings,
  );
  assert.equal(qr.status, 200);
  assert.equal(qr.headers.get("Content-Type"), "image/png");
  assert.equal(
    (await accountResponse(new Request(ORIGIN + pay.qrImage), bindings)).status,
    401,
  );
  DB.sqlite.prepare("UPDATE api_payments SET checked_at=0").run();
  state = { status: "SUCCESS", amount: 14000 };
  assert.equal(
    (await c.call("GET", "/payments/" + pay.id)).status,
    502,
    "short payments are not credited",
  );
  state = { status: "SUCCESS", amount: 15037 };
  const done = (await c.call("GET", "/payments/" + pay.id)).data.payment;
  assert.equal(done.status, "SUCCESS");
  let key = (await c.call("GET", "/keys")).data.keys[0];
  assert.equal(key.plan, "starter");
  assert.equal(key.monthlyLimit, 25000);
  const firstExpiry = key.planExpiresAt;
  assert.ok(firstExpiry > Date.now() + 29 * 86400000);
  // Re-checking a settled order changes nothing.
  await c.call("GET", "/payments/" + pay.id);
  assert.equal(
    (await c.call("GET", "/keys")).data.keys[0].planExpiresAt,
    firstExpiry,
  );

  const topup = (
    await c.call("POST", "/payments", { product: "topup-5k", keyId: item.id })
  ).data.payment;
  state = { status: "SUCCESS", amount: 5037 };
  DB.sqlite.prepare("UPDATE api_payments SET checked_at=0").run();
  const billing = (await c.call("GET", "/billing")).data;
  assert.equal(billing.enabled, true);
  assert.equal(
    billing.payments.find((p) => p.id === topup.id).status,
    "SUCCESS",
  );
  key = (await c.call("GET", "/keys")).data.keys[0];
  assert.equal(key.bonus, 5000);
  assert.equal(key.limit, 30000);

  state = { status: "PENDING", amount: 5037 };
  const third = (
    await c.call("POST", "/payments", { product: "topup-5k", keyId: item.id })
  ).data.payment;
  const cancelled = await c.call(
    "POST",
    "/payments/" + third.id + "/cancel",
    {},
  );
  assert.equal(cancelled.data.payment.status, "CANCELLED");
  assert.equal(
    (await c.call("POST", "/payments/" + third.id + "/cancel", {})).status,
    409,
  );
  assert.equal(
    (await client(bindings).call("GET", "/payments/" + pay.id)).status,
    401,
  );

  assert.equal(
    (
      await accountResponse(new Request(ORIGIN + "/dashboard/api/config"), {
        DB: d1(),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await (
        await accountResponse(new Request(ORIGIN + "/dashboard/api/config"), {
          DB: d1(),
        })
      ).json()
    ).payments,
    false,
  );
});

test("quota periods follow WIB months and lapsed plans fall back to Free", () => {
  // 2026-10-31 18:00 UTC is already 1 November in Jakarta.
  const lateOctober = Date.UTC(2026, 9, 31, 18);
  assert.equal(period(lateOctober), "2026-11");
  assert.equal(
    new Date(resetsAt(lateOctober)).toISOString(),
    "2026-11-30T17:00:00.000Z",
  );
  assert.deepEqual(
    effectiveLimit(
      { plan: "pro", monthly_limit: 150000, plan_expires_at: 10 },
      {},
      20,
    ),
    { plan: "free", monthly: 1000 },
  );
  assert.deepEqual(
    effectiveLimit(
      { plan: "pro", monthly_limit: 150000, plan_expires_at: null },
      {},
      20,
    ),
    { plan: "pro", monthly: 150000 },
  );
  assert.equal(routeOf("GET", "/api/theater/SH2D31"), "GET /api/theater/:id");
  assert.equal(routeOf("HEAD", "/api/news"), "GET /api/news");
  assert.equal(
    products({ API_PRICES: '{"pro-30d":99000,"topup-5k":5}' })["pro-30d"].price,
    99000,
  );
  assert.equal(
    products({ API_PRICES: '{"topup-5k":5}' })["topup-5k"].price,
    5000,
  );
  assert.equal(products({ API_PRICES: "nope" })["pro-30d"].price, 49000);
});

test("fanbase applications need the full form, a follow, and admin review", async () => {
  const DB = d1();
  const bindings = { DB };
  const c = await signedUp(bindings);
  const { item } = (await c.call("POST", "/keys", { name: "Fanbase bot" }))
    .data;
  const form = {
    keyId: item.id,
    name: "Freya Indonesia",
    kind: "member",
    focus: "Freya Jayawardana",
    founded: "2021-04",
    followers: 12000,
    x: "@freyafanbase",
    instagram: "freya.id",
    admin: "Rara",
    contact: "rara@example.test",
    links: ["https://x.com/freyafanbase/status/1"],
    usage:
      "Bot jadwal theater dan pengingat live untuk anggota fanbase kami setiap hari.",
    follower: "freyafanbase",
    follows: true,
    listing: true,
    agree: true,
  };
  assert.equal(
    (await c.call("POST", "/fanbase", { ...form, follows: false })).status,
    400,
  );
  assert.equal(
    (
      await c.call("POST", "/fanbase", {
        ...form,
        links: ["http://insecure.test"],
      })
    ).status,
    400,
  );
  assert.equal(
    (await c.call("POST", "/fanbase", { ...form, usage: "pendek" })).status,
    400,
  );
  assert.equal(
    (await c.call("POST", "/fanbase", { ...form, listing: "ya" })).status,
    400,
  );
  const sent = await c.call("POST", "/fanbase", form);
  assert.equal(sent.status, 201);
  assert.equal(sent.data.application.status, "PENDING");
  assert.equal(sent.data.application.x, "freyafanbase");
  assert.equal((await c.call("POST", "/fanbase", form)).status, 409);
  assert.equal((await c.call("GET", "/fanbase")).data.follow, "JKT48Connect");
  // Nothing is public before review.
  assert.deepEqual(
    (await client(bindings).call("GET", "/fanbases")).data.fanbases,
    [],
  );

  const body = async (request) => request.json();
  const admin = (path, init) =>
    developerAdmin(
      new URL(ORIGIN + "/control/api/developers" + path),
      new Request(ORIGIN, init),
      bindings,
      body,
    );
  const pending = (await admin("/fanbase?status=PENDING")).applications;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].details.contact, "rara@example.test");
  await admin("/fanbase/" + pending[0].id, {
    method: "PUT",
    body: JSON.stringify({ status: "APPROVED", note: "Akun aktif" }),
  });
  const key = (await c.call("GET", "/keys")).data.keys[0];
  assert.equal(key.plan, "fanbase");
  assert.equal(key.monthlyLimit, 50000);
  assert.equal(key.planExpiresAt, null);
  const listed = (await client(bindings).call("GET", "/fanbases")).data
    .fanbases;
  assert.deepEqual(listed, [
    { name: "Freya Indonesia", x: "freyafanbase", focus: "Freya Jayawardana" },
  ]);
  // Withdrawing approval returns the key to Free and removes the listing.
  await admin("/fanbase/" + pending[0].id, {
    method: "PUT",
    body: JSON.stringify({ status: "REJECTED" }),
  });
  assert.equal((await c.call("GET", "/keys")).data.keys[0].plan, "free");
  assert.deepEqual(
    (await client(bindings).call("GET", "/fanbases")).data.fanbases,
    [],
  );
  assert.equal(
    (await c.call("POST", "/fanbase", { ...form, listing: false })).status,
    201,
  );
});

test("QR sources accept every shape the gateway sends", async () => {
  const { qrSource } = await import("../src/accounts/payments.js");
  assert.equal(
    qrSource({ qr_image: "http://yobasepay.net/qr_render?payload=1" }),
    "http://yobasepay.net/qr_render?payload=1",
  );
  assert.equal(
    qrSource({ qr_image: "/qr_render?payload=2" }),
    "https://yobasepay.net/qr_render?payload=2",
  );
  assert.equal(
    qrSource({ qr_image: "data:image/png;base64,iVBORw0KGgo=" }),
    "data:image/png;base64,iVBORw0KGgo=",
  );
  assert.equal(
    qrSource({
      qr_string:
        "00020101021226610016ID.CO.SHOPEE.WWW01189360091800000000000202",
    }),
    "https://yobasepay.net/qr_render?payload=00020101021226610016ID.CO.SHOPEE.WWW01189360091800000000000202",
  );
  assert.equal(qrSource({ qr_image: "javascript:alert(1)" }), null);
  assert.equal(qrSource({}), null);
});

test("dashboard writes need the session CSRF token and same-site fetch metadata", async () => {
  const bindings = { DB: d1(), DASHBOARD_ADMIN_EMAILS: "Admin@Example.test" };
  const c = await signedUp(bindings);
  const raw = (headers) =>
    accountResponse(
      new Request(ORIGIN + "/dashboard/api/keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: ORIGIN,
          Cookie: c.cookie(),
          ...headers,
        },
        body: JSON.stringify({ name: "x" }),
      }),
      bindings,
    );
  assert.equal(
    (await raw({ "X-Requested-With": "jkt48connect" })).status,
    403,
    "no token",
  );
  assert.equal(
    (
      await raw({
        "X-Requested-With": "jkt48connect",
        "X-CSRF-Token": "f".repeat(48),
      })
    ).status,
    403,
  );
  assert.equal(
    (await raw({ "X-CSRF-Token": c.csrf() })).status,
    403,
    "no custom header",
  );
  assert.equal(
    (
      await raw({
        "X-Requested-With": "jkt48connect",
        "X-CSRF-Token": c.csrf(),
      })
    ).status,
    201,
  );
  const cross = await accountResponse(
    new Request(ORIGIN + "/dashboard/api/keys", {
      headers: { Cookie: c.cookie(), "Sec-Fetch-Site": "cross-site" },
    }),
    bindings,
  );
  assert.equal(cross.status, 403);
  const ok = await accountResponse(
    new Request(ORIGIN + "/dashboard/api/keys", {
      headers: { Cookie: c.cookie() },
    }),
    bindings,
  );
  assert.equal(ok.headers.get("X-Frame-Options"), "DENY");
  assert.equal(ok.headers.get("Cross-Origin-Resource-Policy"), "same-origin");
  assert.match(
    ok.headers.get("Content-Security-Policy"),
    /frame-ancestors 'none'/,
  );
  // A new session gets a new token; the old one stops working.
  const old = c.csrf();
  await c.call("POST", "/login", {
    email: "dev@example.test",
    password: "rahasia123",
  });
  assert.notEqual(c.csrf(), old);

  // Admin rights follow the configured email, case-insensitively.
  assert.equal((await c.call("GET", "/session")).data.account.admin, false);
  assert.equal((await c.call("GET", "/admin")).status, 403);
  const admin = await signedUp(bindings, "admin@example.test");
  assert.equal((await admin.call("GET", "/session")).data.account.admin, true);
  const overview = await admin.call("GET", "/admin");
  assert.equal(overview.status, 200);
  assert.equal(overview.data.totals.accounts, 2);
  assert.equal((await admin.call("GET", "/admin/payments")).status, 200);
  assert.equal(
    (await admin.call("DELETE", "/account", { password: "rahasia123" })).status,
    403,
  );
});

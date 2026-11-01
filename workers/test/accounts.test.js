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
  assert.ok(isMetered("/api/jkt48_youtube", "GET"));
  assert.ok(isMetered("/api/jkt48_youtube/hAHv54gxD60", "GET"));
  assert.ok(isMetered("/api/jkt48_youtube/hAHv54gxD60/comments", "GET"));
  assert.ok(isMetered("/api/jkt48_youtube/private", "GET"));
  assert.ok(isMetered("/api/jkt48_youtube", "POST"));
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
    ).response.status,
    401,
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

test('public proxy auth matches router decoding; Origin alone is not authentication',async()=>{
 for(const path of ['/api/jkt48_youtube','/%61pi/jkt48_youtube','/api/%6akt48_youtube','/%61pi/news'])assert.ok(isMetered(path,'GET'));
 const request=apiRequest('/api/jkt48_youtube',{Origin:'https://jkt48connect.app'});
 assert.equal((await meter(request,{API_KEY_REQUIRED:'true',API_KEY_EXEMPT_ORIGINS:'https://jkt48connect.app'},work())).response.status,401);
});

test("JKT48Connect PG uses unique total, private credentials and exactly-once fulfilment", async () => {
  const DB = d1(), bindings = { DB, JKTPG_API_KEY: "pg-private-test", MYPG_API_KEY: "legacy-only" };
  const c = await signedUp(bindings), { item } = (await c.call("POST", "/keys", { name: "PG test" })).data;
  const txs = new Map(); let calls = [], seq = 0, paid = false, wrong = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input); calls.push({url: url.href, method: init.method, headers: init.headers, body: init.body});
    assert.equal(url.hostname, "pg.jkt48connect.app");
    if (url.pathname.endsWith("/qr.svg")) return new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', {headers:{"Content-Type":"image/svg+xml"}});
    assert.equal(init.headers["X-API-Key"], "pg-private-test");
    if (url.pathname === "/api/v1/transactions") {
      assert.equal(init.method,"POST"); const b = JSON.parse(init.body), id="trx_Test"+(++seq);
      assert.equal(b.expires_in,900);assert.match(b.return_url,/^https:\/\/api\.jkt48connect\.app\/dashboard\/pay\/JKC/);
      const tx={id, reference:b.reference, amount:b.amount, unique_code:37, amount_total:b.amount+37, status:"pending", qris_string:"000201010212"+"A".repeat(80), qr_svg_url:"https://pg.jkt48connect.app/api/public/transactions/"+id+"/qr.svg",pay_url:"https://pg.jkt48connect.app/pay/"+id,expires_at:new Date(Date.now()+900000).toISOString()};txs.set(id,tx);return Response.json({data:tx},{status:201});
    }
    const tx=txs.get(url.pathname.split("/").at(-1));assert.ok(tx);
    return Response.json({data:{...tx,status:paid?"paid":"pending",amount_total:tx.amount_total-(wrong?1:0)}});
  };
  const made=await c.call("POST","/payments",{product:"starter-30d",keyId:item.id});assert.equal(made.status,201);
  const p=made.data.payment;assert.equal(p.provider,"jktpg");assert.equal(p.amount,15037);assert.equal(p.uniqueCode,37);assert.match(p.qrisString,/^000201/);assert.equal(p.paymentUrl,"https://pg.jkt48connect.app/pay/trx_Test1");
  assert.equal(JSON.parse(calls[0].body).reference,p.id);assert.ok(!calls[0].body.includes(bindings.JKTPG_API_KEY));
  const qr=await accountResponse(new Request(ORIGIN+p.qrImage,{headers:{Cookie:c.cookie()}}),bindings);assert.equal(qr.status,200);assert.equal(qr.headers.get("Content-Type"),"image/svg+xml");
  paid=true;wrong=true;DB.sqlite.prepare("UPDATE api_payments SET checked_at=0").run();assert.equal((await c.call("GET","/payments/"+p.id)).status,502);
  assert.equal(DB.sqlite.prepare("SELECT fulfilled_at FROM api_payments WHERE id=?").get(p.id).fulfilled_at,null);
  wrong=false;assert.equal((await c.call("GET","/payments/"+p.id)).data.payment.status,"SUCCESS");
  const expiry=(await c.call("GET","/keys")).data.keys[0].planExpiresAt;
  await c.call("GET","/payments/"+p.id);assert.equal((await c.call("GET","/keys")).data.keys[0].planExpiresAt,expiry);
  paid=false;const topup=(await c.call("POST","/payments",{product:"topup-5k",keyId:item.id})).data.payment;
  const stale=DB.sqlite.prepare("SELECT * FROM api_payments WHERE id=?").get(topup.id);paid=true;
  const {refreshPayment}=await import("../src/accounts/payments.js");const originalNow=Date.now;const instant=originalNow();Date.now=()=>instant;
  try{await Promise.all([refreshPayment(bindings,stale,{force:true}),refreshPayment(bindings,stale,{force:true})]);}finally{Date.now=originalNow;}
  assert.equal(DB.sqlite.prepare("SELECT sum(requests) AS total FROM api_topups").get().total,5000,"two same-millisecond confirmations cannot credit twice");
  const outsider=await signedUp(bindings,"other-pg@example.test");
  assert.equal((await outsider.call("GET","/payments/"+p.id)).status,404);
});

test("JKT48Connect PG cancellation checks paid-during-cancel race", async () => {
  const DB=d1(),bindings={DB,JKTPG_API_KEY:"pg-private"};const c=await signedUp(bindings);const {item}=(await c.call("POST","/keys",{name:"Cancel"})).data;
  let tx, paid=false, race=false;
  globalThis.fetch=async(input,init)=>{
    const u=new URL(input);
    if(u.pathname==="/api/v1/transactions"){const b=JSON.parse(init.body);tx={id:"trx_Cancel"+b.reference,reference:b.reference,amount:b.amount,unique_code:17,amount_total:b.amount+17,status:"pending",pay_url:"https://pg.jkt48connect.app/pay/trx_Cancel"+b.reference,expires_at:new Date(Date.now()+900000).toISOString()};return Response.json({data:tx},{status:201});}
    if(u.pathname.endsWith("/cancel")){if(race){paid=true;return Response.json({error:"already paid"},{status:409})}tx.status="cancelled";return Response.json({data:tx});}
    return Response.json({data:{...tx,status:paid?"paid":tx.status}});
  };
  let p=(await c.call("POST","/payments",{product:"topup-5k",keyId:item.id})).data.payment;
  assert.equal((await c.call("POST","/payments/"+p.id+"/cancel",{})).data.payment.status,"CANCELLED");
  assert.equal((await c.call("POST","/payments/"+p.id+"/cancel",{})).status,409);
  p=(await c.call("POST","/payments",{product:"topup-5k",keyId:item.id})).data.payment;race=true;
  assert.equal((await c.call("POST","/payments/"+p.id+"/cancel",{})).data.payment.status,"SUCCESS");
  assert.equal(DB.sqlite.prepare("SELECT count(*) AS n FROM api_topups").get().n,1);
});

test("JKT48Connect PG webhook rejects stale/tampered data and credits once", async () => {
  const DB=d1(),bindings={DB,JKTPG_API_KEY:"pg-private",JKTPG_WEBHOOK_SECRET:"webhook-private"};const c=await signedUp(bindings);const {item}=(await c.call("POST","/keys",{name:"Webhook"})).data;let tx,checks=0;
  globalThis.fetch=async(input,init)=>{
    if(init.method==="POST"){const b=JSON.parse(init.body);tx={id:"trx_Webhook",reference:b.reference,amount:b.amount,amount_total:b.amount+27,unique_code:27,status:"pending",pay_url:"https://pg.jkt48connect.app/pay/trx_Webhook",expires_at:new Date(Date.now()+900000).toISOString()};return Response.json({data:tx},{status:201});}
    checks++;return Response.json({data:{...tx,status:"paid"}});
  };
  const p=(await c.call("POST","/payments",{product:"topup-5k",keyId:item.id})).data.payment;
  const {createHmac}=await import("node:crypto");
  async function hook({age=0,tamper=false,delta=0}={}){
    const timestamp=String(Math.floor(Date.now()/1000)-age),body=JSON.stringify({event:"transaction.paid",data:{...tx,status:"paid",amount_total:tx.amount_total+delta}});
    const signature="sha256="+createHmac("sha256",bindings.JKTPG_WEBHOOK_SECRET).update(timestamp+"."+body).digest("hex");
    return accountResponse(new Request(ORIGIN+"/dashboard/api/payments/webhook/jktpg",{method:"POST",headers:{"Content-Type":"application/json","X-PG-Timestamp":timestamp,"X-PG-Signature":tamper?"sha256="+"0".repeat(64):signature},body}),bindings);
  }
  assert.equal((await hook({age:301})).status,401);assert.equal((await hook({tamper:true})).status,401);assert.equal((await hook({delta:1})).status,502);assert.equal(checks,0);
  assert.equal((await hook()).status,200);assert.equal((await hook()).status,200);assert.equal(checks,1);
  assert.equal(DB.sqlite.prepare("SELECT status FROM api_payments WHERE id=?").get(p.id).status,"SUCCESS");
  assert.equal(DB.sqlite.prepare("SELECT sum(requests) AS n FROM api_topups").get().n,5000);
});

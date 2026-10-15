import { newVoucher, normalizeVoucher, period, plans, sha256 } from "./core.js";
import { forgetKey } from "./metering.js";
import { adminApplications, reviewApplication } from "./fanbase.js";

// Admin side of developer accounts, mounted inside the authenticated control
// panel: list accounts, mint top-up vouchers, change plans, credit a key.
const bad = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const count = (value, max) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) bad(`Nilai harus 1–${max}`);
  return n;
};

export async function developerAdmin(url, request, bindings, body) {
  const DB = bindings.DB,
    route = url.pathname.slice("/control/api/developers".length),
    month = period(),
    available = plans(bindings);
  if (route === "" && request.method === "GET") {
    const query = (url.searchParams.get("q") || "").trim().slice(0, 80);
    const { results: accounts } = await DB.prepare(
      `SELECT id,email,name,created_at,last_login_at FROM api_accounts
       ${query ? "WHERE email LIKE ?1 OR name LIKE ?1" : ""} ORDER BY created_at DESC LIMIT 100`,
    )
      .bind(...(query ? ["%" + query.replace(/[%_]/g, "") + "%"] : []))
      .all();
    const ids = accounts.map((a) => a.id);
    const keys = ids.length
      ? (
          await DB.prepare(
            `SELECT k.id,k.account_id,k.name,k.prefix,k.last4,k.plan,k.monthly_limit,k.created_at,k.last_used_at,k.revoked_at,u.used,u.bonus
             FROM api_keys k LEFT JOIN api_key_usage u ON u.key_id=k.id AND u.period=?
             WHERE k.account_id IN (${ids.map(() => "?").join(",")}) ORDER BY k.created_at`,
          )
            .bind(month, ...ids)
            .all()
        ).results
      : [];
    const totals = await DB.prepare(
      `SELECT (SELECT count(*) FROM api_accounts) AS accounts,
              (SELECT count(*) FROM api_keys WHERE revoked_at IS NULL) AS keys,
              (SELECT coalesce(sum(used),0) FROM api_key_usage WHERE period=?) AS requests,
              (SELECT count(*) FROM api_vouchers WHERE redeemed_at IS NULL) AS vouchers`,
    )
      .bind(month)
      .first();
    return {
      period: month,
      plans: Object.entries(available).map(([id, p]) => ({ id, ...p })),
      totals,
      accounts: accounts.map((a) => ({
        ...a,
        keys: keys
          .filter((k) => k.account_id === a.id)
          .map((k) => ({
            id: k.id,
            name: k.name,
            preview: `${k.prefix}…${k.last4}`,
            plan: k.plan,
            limit: k.monthly_limit + (k.bonus || 0),
            monthlyLimit: k.monthly_limit,
            bonus: k.bonus || 0,
            used: k.used || 0,
            lastUsedAt: k.last_used_at,
            revokedAt: k.revoked_at,
          })),
      })),
    };
  }
  if (route === "/fanbase" && request.method === "GET") {
    const status = url.searchParams.get("status");
    return {
      applications: await adminApplications(
        DB,
        ["PENDING", "APPROVED", "REJECTED"].includes(status) ? status : null,
      ),
    };
  }
  const review = route.match(/^\/fanbase\/(FB[A-F0-9]{16})$/);
  if (review && request.method === "PUT") {
    const data = await body(request);
    return reviewApplication(bindings, review[1], data.status, data.note);
  }
  if (route === "/vouchers" && request.method === "POST") {
    const data = await body(request);
    const requests = count(data.requests, 10000000),
      amount = count(data.count ?? 1, 50),
      note = String(data.note || "").slice(0, 80),
      now = Date.now();
    const codes = Array.from({ length: amount }, newVoucher);
    await DB.batch(
      await Promise.all(
        codes.map(async (code) =>
          DB.prepare(
            "INSERT INTO api_vouchers(code_hash,hint,requests,note,created_at) VALUES(?,?,?,?,?)",
          ).bind(
            await sha256("voucher:" + normalizeVoucher(code)),
            code.slice(-4),
            requests,
            note,
            now,
          ),
        ),
      ),
    );
    // Codes are stored hashed: this response is the only time they are shown.
    return { codes, requests, note };
  }
  const keyRoute = route.match(/^\/keys\/([a-f0-9]{24})(\/topup)?$/);
  if (keyRoute) {
    const key = await DB.prepare(
      "SELECT id,account_id,key_hash FROM api_keys WHERE id=?",
    )
      .bind(keyRoute[1])
      .first();
    if (!key) bad("API key tidak ditemukan", 404);
    const data = await body(request);
    if (keyRoute[2] && request.method === "POST") {
      const requests = count(data.requests, 10000000),
        now = Date.now();
      await DB.batch([
        DB.prepare(
          `INSERT INTO api_key_usage(key_id,period,used,bonus) VALUES(?,?,0,?)
           ON CONFLICT(key_id,period) DO UPDATE SET bonus=bonus+excluded.bonus`,
        ).bind(key.id, month, requests),
        DB.prepare(
          "INSERT INTO api_topups(account_id,key_id,period,requests,source,created_at) VALUES(?,?,?,?,'admin',?)",
        ).bind(key.account_id, key.id, month, requests, now),
      ]);
      return { ok: true, requests, period: month };
    }
    if (!keyRoute[2] && request.method === "PUT") {
      const plan = available[data.plan]
        ? data.plan
        : bad("Paket tidak dikenal");
      const limit =
        data.monthlyLimit == null
          ? available[plan].monthly
          : count(data.monthlyLimit, 100000000);
      await DB.prepare("UPDATE api_keys SET plan=?,monthly_limit=? WHERE id=?")
        .bind(plan, limit, key.id)
        .run();
      forgetKey(key.key_hash);
      return { ok: true, plan, monthlyLimit: limit };
    }
  }
  bad("Endpoint tidak ditemukan", 404);
}

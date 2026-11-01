// Merchant credentials and signed status checks stay on the server.
const ORIGIN = "https://pg.jkt48connect.app";
const STATUS = { pending: "PENDING", paid: "SUCCESS", expired: "EXPIRED", cancelled: "CANCELLED" };
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export function pgUrl(value, path) {
  try {
    const url = new URL(value);
    return url.origin === ORIGIN && !url.username && !url.password && !url.search && !url.hash && (!path || url.pathname === path) ? url.href : null;
  } catch { return null; }
}
export async function jktpg(bindings, action, fields) {
  if (!bindings.JKTPG_API_KEY) fail(503, "Gateway pembayaran belum dikonfigurasi");
  let path = "/api/v1/transactions", method = "POST", body;
  if (action === "createpayment") body = { amount: Number(fields.amount), reference: fields.ref_id, description: fields.description || "Paket API JKT48Connect", expires_in: 900, return_url: "https://api.jkt48connect.app/dashboard/pay/" + encodeURIComponent(fields.ref_id) };
  else {
    if (!/^trx_[A-Za-z0-9]+$/.test(fields.trxid || "")) fail(502, "ID transaksi gateway tidak valid");
    path += "/" + encodeURIComponent(fields.trxid);
    if (action === "checkstatus") method = "GET";
    else if (action === "cancelpayment") path += "/cancel";
    else fail(500, "Operasi gateway tidak valid");
  }
  let response, json;
  try {
    response = await fetch(ORIGIN + path, { method, headers: { "X-API-Key": bindings.JKTPG_API_KEY, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: "error", signal: AbortSignal.timeout(15000) });
  } catch { fail(502, "Gateway pembayaran tidak dapat dihubungi"); }
  try { json = await response.json(); } catch { fail(502, "Respons gateway pembayaran tidak valid"); }
  if (!response.ok) {
    const error = Object.assign(new Error("Gateway pembayaran menolak permintaan (HTTP " + response.status + ")"), { status: 502, gatewayStatus: response.status });
    throw error;
  }
  const data = json?.data;
  if (!data || Array.isArray(data) || !/^trx_[A-Za-z0-9]+$/.test(data.id || "") || !STATUS[data.status]) fail(502, "Respons transaksi gateway tidak valid");
  return { ...data, trx_id: data.id, base_amount: data.amount, amount: data.amount_total, status: STATUS[data.status], payment_url: pgUrl(data.pay_url, "/pay/" + data.id), qr_image: pgUrl(data.qr_svg_url, "/api/public/transactions/" + data.id + "/qr.svg"), expired_at: data.expires_at };
}
export function validateTransaction(data, row, { creating = false } = {}) {
  const amount = Number(data.amount), base = Number(data.base_amount), unique = Number(data.unique_code);
  if (data.reference !== row.id || (row.trx_id && data.trx_id !== row.trx_id) || base !== row.amount || !Number.isSafeInteger(base) || !Number.isSafeInteger(amount) || !Number.isSafeInteger(unique) || unique < 1 || unique > 300 || amount !== base + unique || (!creating && amount !== row.paid_amount)) fail(502, "Nominal atau referensi pembayaran tidak sesuai");
  if (creating && (data.status !== "PENDING" || !Number.isFinite(Date.parse(data.expired_at)) || Date.parse(data.expired_at) <= Date.now() || (!data.qr_image && !data.payment_url))) fail(502, "Tagihan QRIS dari gateway tidak lengkap");
}
export async function verifyWebhook(request, secret) {
  if (!secret) fail(503, "Webhook pembayaran belum dikonfigurasi");
  if (request.method !== "POST") fail(405, "Gunakan POST");
  const timestamp = request.headers.get("X-PG-Timestamp") || "", signature = request.headers.get("X-PG-Signature") || "";
  if (!/^\d{9,11}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !/^sha256=[a-f0-9]{64}$/i.test(signature)) fail(401, "Tanda tangan webhook tidak valid");
  if (Number(request.headers.get("Content-Length")) > 65536) fail(413, "Webhook terlalu besar");
  const raw = await request.text(); if (new TextEncoder().encode(raw).length > 65536) fail(413, "Webhook terlalu besar");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + "." + raw)));
  const expected = "sha256=" + Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
  let diff = 0; for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.toLowerCase().charCodeAt(i);
  if (diff) fail(401, "Tanda tangan webhook tidak valid");
  try { return JSON.parse(raw); } catch { fail(400, "JSON webhook tidak valid"); }
}

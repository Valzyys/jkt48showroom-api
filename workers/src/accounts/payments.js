import { period, plans, products, randomHex } from "./core.js";
import { forgetKey } from "./metering.js";

// Plan and top-up purchases through the MYPG gateway (yobasepay.net). The
// project key stays in the Worker env (MYPG_API_KEY) and never reaches the
// browser. There is no webhook: payments are confirmed by polling
// checkstatus while the buyer watches, and again whenever billing loads.
const GATEWAY = "https://yobasepay.net/api_my";
const STATES = new Set(["PENDING", "SUCCESS", "EXPIRED", "CANCELLED"]);

const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};

export async function gateway(bindings, action, fields) {
  if (!bindings.MYPG_API_KEY) fail(503, "Pembayaran belum dikonfigurasi");
  let response;
  try {
    response = await fetch(`${GATEWAY}?action=${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      // The key goes in the body, never the URL, so it stays out of logs.
      body: new URLSearchParams({
        api_key: bindings.MYPG_API_KEY,
        ...fields,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    fail(502, "Gateway pembayaran tidak dapat dihubungi");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    fail(502, "Respons gateway pembayaran tidak valid");
  }
  if (!response.ok || data?.status !== true || !data.data)
    fail(
      502,
      "Gateway menolak permintaan: " +
        String(data?.message || response.status).slice(0, 120),
    );
  return data.data;
}

// Only the gateway's own hosts may be shown as a QR image or a pay link.
const safeUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" &&
      (url.hostname === "yobasepay.net" ||
        url.hostname.endsWith(".yobasepay.net"))
      ? url.href
      : null;
  } catch {
    return null;
  }
};

// The gateway's QR comes in several shapes: an absolute URL (http or https,
// any of its hosts), a path on yobasepay.net, a data: image, or only the raw
// QRIS payload. Keep whatever arrives; the browser always loads it through
// our own /payments/<id>/qr so the page never depends on the gateway's host.
const QR_FIELDS = ["qr_image", "qr_url", "qris_image", "qr_link", "qr"];
const PAYLOAD_FIELDS = [
  "qr_string",
  "qris",
  "qr_content",
  "qris_string",
  "payload",
];
export function qrSource(data = {}) {
  for (const field of QR_FIELDS) {
    const value = typeof data[field] === "string" ? data[field].trim() : "";
    if (!value) continue;
    if (
      /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(
        value,
      )
    )
      return value.length <= 400000 ? value : null;
    try {
      const url = new URL(value, "https://yobasepay.net/");
      if (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      )
        return url.href.slice(0, 4000);
    } catch {}
  }
  for (const field of PAYLOAD_FIELDS) {
    const value = typeof data[field] === "string" ? data[field].trim() : "";
    if (/^000201[\x20-\x7e]{20,600}$/.test(value))
      return (
        "https://yobasepay.net/qr_render?payload=" + encodeURIComponent(value)
      );
  }
  return null;
}

// Private and loopback hosts are never fetched on a user's behalf.
const privateHost = (host) =>
  /^(localhost|0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|\[|::|fc|fd)/i.test(
    host,
  ) ||
  host.endsWith(".internal") ||
  host.endsWith(".local");

export async function qrImage(row) {
  const source = row.qr_image;
  if (!source || row.status !== "PENDING") fail(404, "QR tidak tersedia");
  const headers = {
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=120",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  const inline = source.match(/^data:(image\/[a-z+]+);base64,(.+)$/is);
  if (inline) {
    const bytes = Uint8Array.from(atob(inline[2].replace(/\s/g, "")), (c) =>
      c.charCodeAt(0),
    );
    return new Response(bytes, {
      headers: { ...headers, "Content-Type": inline[1] },
    });
  }
  const url = new URL(source);
  if (privateHost(url.hostname)) fail(404, "QR tidak tersedia");
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "image/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    fail(502, "Gambar QR tidak dapat diambil");
  }
  const type = response.headers.get("Content-Type") || "";
  if (!response.ok || !/^image\//i.test(type))
    fail(502, "Gambar QR tidak valid");
  const body = await response.arrayBuffer();
  if (body.byteLength > 1048576) fail(502, "Gambar QR terlalu besar");
  return new Response(body, {
    headers: { ...headers, "Content-Type": type.split(";")[0] },
  });
}

export function publicPayment(row, catalog) {
  const product = catalog[row.product];
  return {
    id: row.id,
    product: row.product,
    label: product?.label || row.product,
    kind: product?.kind,
    amount: row.paid_amount || row.amount,
    baseAmount: row.amount,
    status: row.status,
    trxId: row.trx_id,
    paymentUrl: row.status === "PENDING" ? row.payment_url : null,
    qrImage:
      row.status === "PENDING" && row.qr_image
        ? `/dashboard/api/payments/${row.id}/qr`
        : null,
    expiredAt: row.expired_at,
    createdAt: row.created_at,
    fulfilledAt: row.fulfilled_at,
    keyName: row.key_name,
  };
}

export async function createPayment(bindings, account, key, productId) {
  const catalog = products(bindings),
    product = catalog[productId];
  if (!product) fail(400, "Produk tidak dikenal");
  const DB = bindings.DB;
  const { pending } = await DB.prepare(
    "SELECT count(*) AS pending FROM api_payments WHERE account_id=? AND status='PENDING' AND created_at>?",
  )
    .bind(account.id, Date.now() - 3600000)
    .first();
  if (pending >= 3)
    fail(429, "Selesaikan atau batalkan tagihan yang masih menunggu dulu");
  const id = "JKC" + randomHex(8).toUpperCase(),
    now = Date.now();
  const data = await gateway(bindings, "createpayment", {
    amount: String(product.price),
    ref_id: id,
  });
  const amount = Number(data.amount);
  if (!data.trx_id || !Number.isSafeInteger(amount) || amount < product.price)
    fail(502, "Tagihan dari gateway tidak sesuai");
  await DB.prepare(
    `INSERT INTO api_payments(id,account_id,key_id,product,amount,paid_amount,trx_id,payment_url,qr_image,status,expired_at,created_at,checked_at)
     VALUES(?,?,?,?,?,?,?,?,?,'PENDING',?,?,?)`,
  )
    .bind(
      id,
      account.id,
      key.id,
      productId,
      product.price,
      amount,
      String(data.trx_id).slice(0, 60),
      safeUrl(data.payment_url),
      qrSource(data),
      String(data.expired_at || "").slice(0, 32),
      now,
      now,
    )
    .run();
  return publicPayment(
    {
      id,
      product: productId,
      amount: product.price,
      paid_amount: amount,
      status: "PENDING",
      trx_id: data.trx_id,
      payment_url: safeUrl(data.payment_url),
      qr_image: qrSource(data),
      expired_at: data.expired_at,
      created_at: now,
      key_name: key.name,
    },
    catalog,
  );
}

// Apply a paid order exactly once: the status flip is the claim, and the
// credit statements only match the row this batch just claimed.
async function fulfil(bindings, row, product, paidAmount, now) {
  const DB = bindings.DB,
    month = period(now);
  const claim = DB.prepare(
    "UPDATE api_payments SET status='SUCCESS',paid_amount=?,fulfilled_at=?,checked_at=? WHERE id=? AND fulfilled_at IS NULL",
  ).bind(paidAmount, now, now, row.id);
  const claimed = `EXISTS (SELECT 1 FROM api_payments WHERE id=? AND fulfilled_at=?)`;
  const credit =
    product.kind === "topup"
      ? [
          DB.prepare(
            `INSERT INTO api_key_usage(key_id,period,used,bonus) SELECT ?,?,0,? WHERE ${claimed}
             ON CONFLICT(key_id,period) DO UPDATE SET bonus=bonus+excluded.bonus`,
          ).bind(row.key_id, month, product.requests, row.id, now),
          DB.prepare(
            `INSERT INTO api_topups(account_id,key_id,period,requests,source,created_at)
             SELECT ?,?,?,?,'payment',? WHERE ${claimed}`,
          ).bind(
            row.account_id,
            row.key_id,
            month,
            product.requests,
            now,
            row.id,
            now,
          ),
        ]
      : [
          // Renewing the same plan extends it; a new plan starts today.
          DB.prepare(
            `UPDATE api_keys SET
               plan_expires_at=CASE WHEN plan=?1 AND plan_expires_at>?2 THEN plan_expires_at ELSE ?2 END + ?3,
               plan=?1, monthly_limit=?4
             WHERE id=?5 AND EXISTS (SELECT 1 FROM api_payments WHERE id=?6 AND fulfilled_at=?2)`,
          ).bind(
            product.plan,
            now,
            product.days * 86400000,
            plans(bindings)[product.plan].monthly,
            row.key_id,
            row.id,
          ),
        ];
  await DB.batch([claim, ...credit]);
  const key = await DB.prepare("SELECT key_hash FROM api_keys WHERE id=?")
    .bind(row.key_id)
    .first();
  forgetKey(key?.key_hash);
}

export async function refreshPayment(bindings, row, { force = false } = {}) {
  if (row.status !== "PENDING") return row;
  const now = Date.now();
  // Throttle gateway checks per order; the buyer's page polls every few seconds.
  if (!force && row.checked_at && now - row.checked_at < 4000) return row;
  const DB = bindings.DB;
  const data = await gateway(bindings, "checkstatus", { trxid: row.trx_id });
  const status = STATES.has(data.status) ? data.status : "PENDING";
  if (data.trx_id && data.trx_id !== row.trx_id)
    fail(502, "Status gateway tidak cocok dengan tagihan");
  const product = products(bindings)[row.product];
  if (status === "SUCCESS") {
    const paid = Number(data.amount);
    // Never credit less money than the product costs.
    if (!product || !Number.isSafeInteger(paid) || paid < row.amount)
      fail(502, "Nominal pembayaran tidak sesuai, hubungi admin");
    await fulfil(bindings, row, product, paid, now);
    return { ...row, status: "SUCCESS", paid_amount: paid, fulfilled_at: now };
  }
  // checkstatus also carries the QR and pay link; fill in what creation lacked.
  const qr = qrSource(data) || row.qr_image,
    link = safeUrl(data.payment_url) || row.payment_url;
  await DB.prepare(
    "UPDATE api_payments SET status=?,checked_at=?,qr_image=?,payment_url=? WHERE id=? AND status='PENDING'",
  )
    .bind(status, now, qr, link, row.id)
    .run();
  return { ...row, status, checked_at: now, qr_image: qr, payment_url: link };
}

export async function cancelPayment(bindings, row) {
  if (row.status !== "PENDING") fail(409, "Tagihan ini sudah tidak menunggu");
  // A payment made just before cancelling still counts.
  const latest = await refreshPayment(bindings, row, { force: true });
  if (latest.status !== "PENDING") return latest;
  await gateway(bindings, "cancelpayment", { trxid: row.trx_id });
  await bindings.DB.prepare(
    "UPDATE api_payments SET status='CANCELLED',checked_at=? WHERE id=? AND status='PENDING'",
  )
    .bind(Date.now(), row.id)
    .run();
  return { ...latest, status: "CANCELLED" };
}

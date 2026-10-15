import { plans, randomHex } from "./core.js";
import { forgetKey } from "./metering.js";

// Fanbase program: verified fan communities get the Fanbase plan for free.
// They apply with a detailed form, must follow the project's X account, and
// choose whether their name may be listed on the docs site. An admin reviews
// every application in the control panel before the plan is granted.
export const followHandle = (bindings = {}) =>
  /^[A-Za-z0-9_]{1,15}$/.test(bindings.FANBASE_X_HANDLE || "")
    ? bindings.FANBASE_X_HANDLE
    : "JKT48Connect";

const KINDS = {
  member: "Fanbase member (oshi)",
  group: "Fanbase grup / tim",
  community: "Komunitas atau proyek fans",
};
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const text = (value, label, min, max) => {
  const v = typeof value === "string" ? value.trim() : "";
  if (v.length < min || v.length > max)
    fail(`${label} harus ${min}–${max} karakter`);
  return v;
};
const handle = (value, label, required = true) => {
  const v = typeof value === "string" ? value.trim().replace(/^@/, "") : "";
  if (!v && !required) return "";
  if (!/^[A-Za-z0-9_.]{1,30}$/.test(v)) fail(`${label} tidak valid`);
  return v;
};

// Validate and normalise an application. Everything stored is plain text the
// control panel escapes on render.
export function readApplication(data) {
  const kind = KINDS[data.kind] ? data.kind : fail("Pilih jenis fanbase");
  const founded = typeof data.founded === "string" ? data.founded : "";
  if (!/^(20[0-4]\d)-(0[1-9]|1[0-2])$/.test(founded))
    fail("Isi bulan berdiri (YYYY-MM)");
  if (founded > new Date().toISOString().slice(0, 7))
    fail("Bulan berdiri tidak boleh di masa depan");
  const followers = Number(data.followers);
  if (!Number.isSafeInteger(followers) || followers < 0 || followers > 1e8)
    fail("Isi perkiraan jumlah pengikut");
  const links = (Array.isArray(data.links) ? data.links : [])
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
  if (!links.length || links.length > 3)
    fail("Sertakan 1–3 link bukti aktivitas fanbase");
  for (const link of links) {
    let url;
    try {
      url = new URL(link);
    } catch {}
    if (!url || url.protocol !== "https:" || link.length > 300)
      fail("Link bukti harus URL https");
  }
  const x = handle(data.x, "Akun X fanbase");
  if (x.length > 15 || x.includes(".")) fail("Akun X fanbase tidak valid");
  const follower = handle(data.follower, "Username X yang mengikuti");
  if (data.follows !== true)
    fail("Wajib follow akun X JKT48Connect sebelum mengajukan");
  if (typeof data.listing !== "boolean")
    fail("Pilih apakah nama fanbase boleh dicantumkan");
  if (data.agree !== true) fail("Setujui ketentuan program fanbase");
  return {
    name: text(data.name, "Nama fanbase", 2, 80),
    kind,
    focus: text(data.focus, "Member atau fokus fanbase", 2, 80),
    founded,
    followers,
    x,
    instagram: handle(data.instagram, "Instagram", false),
    tiktok: handle(data.tiktok, "TikTok", false),
    admin: text(data.admin, "Nama pengelola", 2, 60),
    contact: text(data.contact, "Kontak pengelola", 5, 100),
    links,
    usage: text(data.usage, "Rencana penggunaan API", 30, 1000),
    follower,
    listing: data.listing,
  };
}

const view = (row) => {
  const details = JSON.parse(row.details);
  return {
    id: row.id,
    status: row.status,
    name: row.name,
    x: row.x_handle,
    listing: Boolean(row.listing),
    keyId: row.key_id,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    note: row.review_note,
    details: { ...details, kindLabel: KINDS[details.kind] },
  };
};

export async function latestApplication(DB, accountId) {
  const row = await DB.prepare(
    "SELECT * FROM api_fanbase_applications WHERE account_id=? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(accountId)
    .first();
  return row ? view(row) : null;
}

export async function submitApplication(DB, account, key, form) {
  const latest = await latestApplication(DB, account.id);
  if (latest?.status === "PENDING") fail("Pengajuanmu masih ditinjau", 409);
  if (latest?.status === "APPROVED") fail("Fanbase-mu sudah disetujui", 409);
  const id = "FB" + randomHex(8).toUpperCase(),
    now = Date.now();
  const { name, x, listing, ...details } = form;
  await DB.prepare(
    "INSERT INTO api_fanbase_applications(id,account_id,key_id,status,name,x_handle,listing,details,created_at) VALUES(?,?,?,'PENDING',?,?,?,?,?)",
  )
    .bind(
      id,
      account.id,
      key.id,
      name,
      x,
      listing ? 1 : 0,
      JSON.stringify(details),
      now,
    )
    .run();
  return latestApplication(DB, account.id);
}

// The public roll on the docs site: approved fanbases that agreed to it.
export async function listedFanbases(DB) {
  const { results } = await DB.prepare(
    `SELECT name,x_handle,details,reviewed_at FROM api_fanbase_applications
     WHERE status='APPROVED' AND listing=1 ORDER BY reviewed_at LIMIT 300`,
  ).all();
  return results.map((r) => ({
    name: r.name,
    x: r.x_handle,
    focus: JSON.parse(r.details).focus,
  }));
}

export async function adminApplications(DB, status) {
  const { results } = await DB.prepare(
    `SELECT f.*,a.email,a.name AS account_name,k.name AS key_name,k.prefix,k.last4 FROM api_fanbase_applications f
     JOIN api_accounts a ON a.id=f.account_id JOIN api_keys k ON k.id=f.key_id
     ${status ? "WHERE f.status=?" : ""} ORDER BY f.created_at DESC LIMIT 100`,
  )
    .bind(...(status ? [status] : []))
    .all();
  return results.map((r) => ({
    ...view(r),
    account: { email: r.email, name: r.account_name },
    key: { name: r.key_name, preview: `${r.prefix}…${r.last4}` },
  }));
}

// Approving grants the plan to the chosen key with no expiry; rejecting an
// approved fanbase moves that key back to Free.
export async function reviewApplication(bindings, id, decision, note = "") {
  const DB = bindings.DB;
  if (!["APPROVED", "REJECTED"].includes(decision))
    fail("Keputusan tidak valid");
  const row = await DB.prepare(
    "SELECT f.*,k.key_hash,k.revoked_at FROM api_fanbase_applications f JOIN api_keys k ON k.id=f.key_id WHERE f.id=?",
  )
    .bind(id)
    .first();
  if (!row) fail("Pengajuan tidak ditemukan", 404);
  if (decision === "APPROVED" && row.revoked_at)
    fail("Key pengajuan sudah dicabut pemiliknya", 409);
  const available = plans(bindings),
    now = Date.now();
  const plan =
    decision === "APPROVED"
      ? ["fanbase", available.fanbase.monthly]
      : ["free", available.free.monthly];
  const statements = [
    DB.prepare(
      "UPDATE api_fanbase_applications SET status=?,reviewed_at=?,review_note=? WHERE id=?",
    ).bind(decision, now, String(note).slice(0, 300), id),
  ];
  if (decision === "APPROVED" || row.status === "APPROVED")
    statements.push(
      DB.prepare(
        "UPDATE api_keys SET plan=?,monthly_limit=?,plan_expires_at=NULL WHERE id=?",
      ).bind(...plan, row.key_id),
    );
  await DB.batch(statements);
  forgetKey(row.key_hash);
  return { ok: true, status: decision };
}

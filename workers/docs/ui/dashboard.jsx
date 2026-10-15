import React, { useEffect, useRef, useState } from "react";
import { useMotionEnabled } from "./motion.js";
import {
  BASE,
  CodeBlock,
  Copy,
  gsap,
  Icon,
  Link,
  navigate,
  useLiquid,
} from "./shared.jsx";
import { AsciiScene } from "./ascii-scene.jsx";
import { PixelIcon } from "./icons.jsx";
import {
  ago,
  api,
  compact,
  date,
  fmt,
  rupiah,
  setAccount,
  time,
  useAccount,
  useApi,
} from "./session.js";

// Developer dashboard: quota, keys, analytics, logs, billing and account.
// Same paper-and-ink language as the docs: rounded panels, pixel icons,
// ASCII meters and Doto numbers. Flat, no shadows.
const SECTIONS = [
  ["", "Ringkasan", "grid"],
  ["keys", "API Keys", "key"],
  ["usage", "Analytics", "pulse"],
  ["logs", "Log request", "list"],
  ["billing", "Paket & tagihan", "card"],
  ["fanbase", "Program fanbase", "gift"],
  ["account", "Akun", "user"],
];

// ---------- small building blocks ----------

export function Panel({ title, icon, action, children, className = "", id }) {
  return (
    <section className={"dash-panel " + className} aria-labelledby={id}>
      {(title || action) && (
        <header className="dash-panel-head">
          {title && (
            <h2 id={id}>
              {icon && <PixelIcon name={icon} size={12} />} {title}
            </h2>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, icon }) {
  return (
    <div className="dash-stat">
      <span className="dash-stat-label">
        <PixelIcon name={icon} size={11} /> {label}
      </span>
      <strong className="dash-num">{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

// ████████░░░░ 64%: the quota as a line of type.
export function Meter({ used, limit, cells = 28, label = true }) {
  const ratio = limit ? Math.min(1, used / limit) : 0,
    filled = Math.round(ratio * cells),
    level = ratio >= 0.9 ? "hot" : ratio >= 0.7 ? "warm" : "";
  return (
    <div
      className={"dash-meter " + level}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={used}
      aria-label={`Terpakai ${fmt(used)} dari ${fmt(limit)}`}
    >
      <span className="dash-meter-bar" aria-hidden="true">
        <b>{"█".repeat(filled)}</b>
        {"░".repeat(cells - filled)}
      </span>
      {label && (
        <span className="dash-meter-pct">{Math.round(ratio * 100)}%</span>
      )}
    </div>
  );
}

export function Empty({ icon = "pulse", title, children }) {
  return (
    <div className="dash-empty">
      <PixelIcon name={icon} size={22} />
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Loading({ rows = 3 }) {
  return (
    <div className="dash-skeleton" aria-label="Memuat">
      {Array.from({ length: rows }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}

export function Failure({ error, onRetry }) {
  return (
    <div className="dash-failure" role="alert">
      <span>{error?.message || "Gagal memuat data"}</span>
      {onRetry && (
        <button type="button" className="dash-btn ghost" onClick={onRetry}>
          Coba lagi
        </button>
      )}
    </div>
  );
}

// Column chart for one daily series. Each column is a full-height hit target
// with a tooltip; grid lines stay quiet. A table view sits underneath.
function Columns({
  series,
  value,
  format = fmt,
  label,
  height = 180,
  tone = "",
}) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...series.map((d) => d[value]));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = [0, top / 2, top];
  const every = series.length > 31 ? 15 : series.length > 14 ? 7 : 2;
  return (
    <figure className={"dash-chart " + tone}>
      <div
        className="dash-chart-plot"
        style={{ height }}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <span
            key={t}
            className="dash-grid"
            style={{ bottom: (t / top) * 100 + "%" }}
          >
            <em>{compact(t)}</em>
          </span>
        ))}
        <div className="dash-cols">
          {series.map((d, i) => (
            <button
              type="button"
              key={d.day}
              className={"dash-col " + (hover === i ? "on" : "")}
              onPointerEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${shortDay(d.day)}: ${format(d[value])} ${label}`}
            >
              <i
                style={{
                  height:
                    Math.max(d[value] ? 2 : 0, (d[value] / top) * 100) + "%",
                }}
              />
            </button>
          ))}
        </div>
        {hover != null && (
          <div
            className="dash-tip"
            style={{
              left: `clamp(70px, ${((hover + 0.5) / series.length) * 100}%, calc(100% - 70px))`,
            }}
            role="status"
          >
            <small>{longDay(series[hover].day)}</small>
            <b>
              {format(series[hover][value])} {label}
            </b>
          </div>
        )}
      </div>
      <div className="dash-chart-x" aria-hidden="true">
        {series.map((d, i) => (
          <span key={d.day}>{i % every === 0 ? shortDay(d.day) : ""}</span>
        ))}
      </div>
      <details className="dash-table-toggle">
        <summary>Lihat sebagai tabel</summary>
        <table className="dash-table">
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>{label}</th>
            </tr>
          </thead>
          <tbody>
            {series.map((d) => (
              <tr key={d.day}>
                <td>{longDay(d.day)}</td>
                <td>{format(d[value])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
function niceStep(max) {
  const raw = max / 2,
    pow = 10 ** Math.floor(Math.log10(raw)),
    n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
const shortDay = (d) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const longDay = (d) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

// Hour of day (WIB): one hue, light to dark.
function HourMap({ hours }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...hours.map((h) => h.requests));
  return (
    <figure className="dash-hours">
      <div className="dash-hours-grid" onPointerLeave={() => setHover(null)}>
        {hours.map((h) => (
          <button
            type="button"
            key={h.hour}
            style={{ "--v": h.requests ? 0.12 + 0.88 * (h.requests / max) : 0 }}
            className={hover === h.hour ? "on" : ""}
            onPointerEnter={() => setHover(h.hour)}
            onFocus={() => setHover(h.hour)}
            aria-label={`Jam ${String(h.hour).padStart(2, "0")}.00: ${fmt(h.requests)} request`}
          />
        ))}
      </div>
      <div className="dash-hours-x" aria-hidden="true">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
      <figcaption>
        {hover != null
          ? `${String(hover).padStart(2, "0")}.00–${String(hover).padStart(2, "0")}.59 WIB · ${fmt(hours[hover].requests)} request`
          : "Arahkan ke kotak untuk melihat jam tersibuk (WIB, 7 hari terakhir)."}
      </figcaption>
    </figure>
  );
}

const STATUS_TEXT = {
  200: "OK",
  201: "Created",
  204: "No Content",
  304: "Not Modified",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  429: "Kuota habis",
  500: "Server Error",
  502: "Bad Gateway",
  503: "Unavailable",
  504: "Timeout",
};
const statusTone = (s) =>
  s >= 500
    ? "bad"
    : s === 429
      ? "warn"
      : s >= 400
        ? "warn"
        : s >= 300
          ? "muted"
          : "good";
export function StatusPill({ status }) {
  const tone = statusTone(status);
  return (
    <span className={"dash-status " + tone}>
      <i aria-hidden="true">
        {tone === "good" ? "●" : tone === "bad" ? "▲" : "◆"}
      </i>
      {status}
    </span>
  );
}
function StatusList({ statuses }) {
  const total = statuses.reduce((a, s) => a + s.requests, 0) || 1;
  if (!statuses.length) return <Empty title="Belum ada request" icon="list" />;
  return (
    <ul className="dash-statuses">
      {statuses.slice(0, 7).map((s) => (
        <li key={s.status}>
          <StatusPill status={s.status} />
          <span className="dash-statuses-name">
            {STATUS_TEXT[s.status] || "HTTP " + s.status}
          </span>
          <span className="dash-share">
            <i
              className={statusTone(s.status)}
              style={{ width: (s.requests / total) * 100 + "%" }}
            />
          </span>
          <b>{fmt(s.requests)}</b>
        </li>
      ))}
    </ul>
  );
}

function RouteTable({ routes }) {
  const total = routes.reduce((a, r) => a + r.requests, 0) || 1;
  if (!routes.length)
    return <Empty title="Belum ada endpoint dipanggil" icon="code" />;
  return (
    <div className="dash-scroll">
      <table className="dash-table routes">
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Request</th>
            <th>Error</th>
            <th>Rata-rata</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((r) => {
            const [method, ...path] = r.route.split(" ");
            return (
              <tr key={r.route}>
                <td>
                  <span className="dash-route">
                    <em className={"method " + method.toLowerCase()}>
                      {method}
                    </em>
                    <code>{path.join(" ")}</code>
                  </span>
                  <span className="dash-share thin">
                    <i style={{ width: (r.requests / total) * 100 + "%" }} />
                  </span>
                </td>
                <td>{fmt(r.requests)}</td>
                <td>
                  {r.requests
                    ? ((r.errors / r.requests) * 100)
                        .toFixed(1)
                        .replace(".", ",") + "%"
                    : "–"}
                </td>
                <td>{fmt(r.avgMs)} ms</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Country code to flag emoji; empty for unknown or Tor ("T1").
export const flag = (cc = "") =>
  /^[A-Z]{2}$/.test(cc) && cc !== "T1" && cc !== "XX"
    ? String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0)))
    : "";
const countryName = (cc) => {
  try {
    return new Intl.DisplayNames(["id"], { type: "region" }).of(cc) || cc;
  } catch {
    return cc;
  }
};
// A readable name for the client behind a user agent: tools first, then browsers.
export function clientName(ua = "") {
  const tools = [
    [/curl\//i, "cURL"],
    [/python-requests|aiohttp|httpx|python-urllib/i, "Python"],
    [/node-fetch|undici|axios|node\b|got\b/i, "Node.js"],
    [/Go-http-client/i, "Go"],
    [/PostmanRuntime/i, "Postman"],
    [/insomnia/i, "Insomnia"],
    [/okhttp/i, "OkHttp (Android)"],
    [/Dart\//i, "Dart / Flutter"],
    [/Discordbot/i, "Discord bot"],
    [/bot|crawler|spider/i, "Bot"],
    [/Wget/i, "Wget"],
  ];
  for (const [re, name] of tools) if (re.test(ua)) return name;
  if (!ua) return "Tanpa user agent";
  return device(ua);
}

function Where({ r }) {
  return (
    <span
      className="dash-where"
      title={[r.city, r.country, r.ip].filter(Boolean).join(" · ")}
    >
      <b aria-hidden="true">{flag(r.country) || "🌐"}</b>
      <span>
        {r.city || (r.country ? countryName(r.country) : "Tidak diketahui")}
        {r.ip && <small>{r.ip}</small>}
      </span>
    </span>
  );
}

function LogTable({ rows, compactView = false, onOpen }) {
  if (!rows.length)
    return (
      <Empty title="Belum ada request tercatat" icon="list">
        Request dengan API key-mu muncul di sini dalam hitungan detik.
      </Empty>
    );
  return (
    <div className="dash-scroll">
      <table className={"dash-table logs " + (onOpen ? "clickable" : "")}>
        <thead>
          <tr>
            <th>Waktu</th>
            <th>Request</th>
            <th>Status</th>
            <th>Durasi</th>
            {!compactView && <th>Asal</th>}
            {!compactView && <th>Client</th>}
            {!compactView && <th>Key</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.id || i}
              tabIndex={onOpen ? 0 : undefined}
              onClick={onOpen ? () => onOpen(r.id) : undefined}
              onKeyDown={
                onOpen
                  ? (e) =>
                      (e.key === "Enter" || e.key === " ") &&
                      (e.preventDefault(), onOpen(r.id))
                  : undefined
              }
            >
              <td title={time(r.at)}>{compactView ? ago(r.at) : time(r.at)}</td>
              <td>
                <span className="dash-route">
                  <em className={"method " + r.method.toLowerCase()}>
                    {r.method}
                  </em>
                  <code>{r.path}</code>
                  {r.keySource === "query" && (
                    <span className="dash-tag">?apikey</span>
                  )}
                </span>
              </td>
              <td>
                <StatusPill status={r.status} />
              </td>
              <td>{fmt(r.ms)} ms</td>
              {!compactView && (
                <td>
                  <Where r={r} />
                </td>
              )}
              {!compactView && (
                <td className="dash-client">{clientName(r.userAgent)}</td>
              )}
              {!compactView && <td>{r.key}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KV({ rows }) {
  return (
    <dl className="dash-kv">
      {rows
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );
}

function PairTable({ rows, empty, valueLabel = "Nilai" }) {
  if (!rows?.length) return <p className="dash-note">{empty}</p>;
  return (
    <div className="dash-scroll">
      <table className="dash-table pairs">
        <thead>
          <tr>
            <th>Nama</th>
            <th>{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name + i}>
              <td>
                <code>{r.name}</code>
              </td>
              <td>
                {r.masked && (
                  <span
                    className="dash-lock"
                    title="Disamarkan sebelum disimpan"
                  >
                    <PixelIcon name="shield" size={10} />
                  </span>
                )}
                <code className={r.masked ? "masked" : ""}>{r.value}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// One request in full: where it came from and what it carried.
function LogDrawer({ id, onClose, onFilter }) {
  const ref = useRef(),
    motionEnabled = useMotionEnabled(),
    { data, error } = useApi("/logs/" + id);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    if (motionEnabled)
      gsap.from(dialog, {
        xPercent: 100,
        duration: 0.6,
        ease: "expo.out",
        clearProps: "transform",
      });
  }, []);
  const close = () => {
    if (!motionEnabled) return ref.current.close();
    gsap.to(ref.current, {
      xPercent: 100,
      duration: 0.35,
      ease: "power3.in",
      onComplete: () => ref.current?.close(),
    });
  };
  const log = data?.log,
    net = log?.network || {};
  return (
    <dialog
      ref={ref}
      className="dash-drawer"
      onClose={onClose}
      onCancel={(e) => (e.preventDefault(), close())}
      aria-labelledby="drawer-title"
    >
      <header className="dash-drawer-head">
        <div>
          <span className="dash-eyebrow">DETAIL REQUEST · #{id}</span>
          {log && (
            <h2 id="drawer-title">
              <em className={"method " + log.method.toLowerCase()}>
                {log.method}
              </em>{" "}
              <code>{log.path}</code>
            </h2>
          )}
        </div>
        <button
          type="button"
          className="dash-dialog-x"
          onClick={close}
          aria-label="Tutup"
        >
          <Icon name="close" size={16} />
        </button>
      </header>
      {error ? (
        <Failure error={error} />
      ) : !log ? (
        <Loading rows={4} />
      ) : (
        <div className="dash-drawer-body">
          <div className="dash-drawer-strip">
            <StatusPill status={log.status} />
            <span>{fmt(log.ms)} ms</span>
            <span>{time(log.at)} WIB</span>
            <span>
              {log.key.name} <code>{log.key.preview}</code>
            </span>
          </div>
          {log.keySource === "query" && (
            <p className="dash-banner warn small">
              <PixelIcon name="info" size={13} /> Key dikirim lewat query{" "}
              <code>?apikey=</code>. Praktis, tapi bisa tercatat di log server
              atau riwayat browser; header <code>X-API-Key</code> lebih aman.
            </p>
          )}
          <section>
            <h3>
              <PixelIcon name="home" size={11} /> Asal request
            </h3>
            <KV
              rows={[
                [
                  "IP",
                  log.ip && (
                    <span className="dash-row">
                      <code>{log.ip}</code>
                      <Copy text={log.ip} label="Salin" />
                      <button
                        type="button"
                        className="dash-link"
                        onClick={() => onFilter({ ip: log.ip })}
                      >
                        Semua request dari IP ini →
                      </button>
                    </span>
                  ),
                ],
                [
                  "Lokasi",
                  [
                    flag(log.country),
                    log.city,
                    log.region,
                    log.country && countryName(log.country),
                  ]
                    .filter(Boolean)
                    .join(" "),
                ],
                [
                  "Jaringan / ISP",
                  [log.isp, net.asn && "AS" + net.asn]
                    .filter(Boolean)
                    .join(" · "),
                ],
                ["Zona waktu", net.timezone],
                ["Kode pos", net.postalCode],
                [
                  "Koordinat",
                  net.latitude && `${net.latitude}, ${net.longitude}`,
                ],
                ["Edge Cloudflare", log.colo],
                [
                  "Protokol",
                  [net.httpProtocol, net.tlsVersion, net.tlsCipher]
                    .filter(Boolean)
                    .join(" · "),
                ],
                [
                  "RTT TCP",
                  net.clientTcpRtt != null && net.clientTcpRtt + " ms",
                ],
              ]}
            />
          </section>
          <section>
            <h3>
              <PixelIcon name="code" size={11} /> Client
            </h3>
            <KV
              rows={[
                ["Client", clientName(log.userAgent)],
                [
                  "User agent",
                  log.userAgent && (
                    <code className="wrap">{log.userAgent}</code>
                  ),
                ],
                ["Origin", log.origin],
                ["Referer", log.referer],
                [
                  "Key dikirim lewat",
                  log.keySource === "query"
                    ? "Query (?apikey= / ?api_key=)"
                    : "Header X-API-Key",
                ],
              ]}
            />
          </section>
          <section>
            <h3>
              <PixelIcon name="search" size={11} /> Query (
              {log.query?.length || 0})
            </h3>
            <PairTable rows={log.query} empty="Tanpa query string." />
          </section>
          <section>
            <h3>
              <PixelIcon name="list" size={11} /> Header (
              {log.headers?.length || 0})
            </h3>
            <PairTable rows={log.headers} empty="Header tidak tercatat." />
          </section>
          <section>
            <h3>
              <PixelIcon name="gift" size={11} /> Cookie (
              {log.cookies?.length || 0})
            </h3>
            <PairTable
              rows={(log.cookies || []).map((c) => ({
                name: c.name,
                value: `•••• (${c.size} karakter)`,
                masked: true,
              }))}
              empty="Request ini tidak membawa cookie."
            />
          </section>
          <p className="dash-note">
            <PixelIcon name="shield" size={11} /> Nilai rahasia (cookie,
            Authorization, API key, token) disamarkan sebelum disimpan. Detail
            disimpan 7 hari.
          </p>
        </div>
      )}
    </dialog>
  );
}

// Ranked list with share bars, used for countries, IPs, clients and origins.
function SourceList({ rows, label, render, onPick, empty = "Belum ada data" }) {
  const total = rows.reduce((a, r) => a + r.requests, 0) || 1;
  if (!rows.length) return <Empty title={empty} icon="pulse" />;
  return (
    <ul className="dash-sources">
      {rows.map((r) => (
        <li key={r.value}>
          <button
            type="button"
            disabled={!onPick}
            onClick={() => onPick?.(r)}
            title={onPick ? "Lihat log" : undefined}
          >
            <span className="dash-sources-name">{render(r)}</span>
            <span className="dash-share">
              <i style={{ width: (r.requests / total) * 100 + "%" }} />
            </span>
            <b>{fmt(r.requests)}</b>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Segmented({ value, onChange, options, label }) {
  const box = useRef(),
    pill = useLiquid(box, "button.on", [value]);
  return (
    <div className="dash-seg" ref={box} role="group" aria-label={label}>
      <span className="dash-seg-pill" ref={pill} aria-hidden="true" />
      {options.map(([v, text]) => (
        <button
          type="button"
          key={v}
          className={v === value ? "on" : ""}
          aria-pressed={v === value}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function KeySelect({ keys, value, onChange, all = true, label = "API key" }) {
  return (
    <label className="dash-select">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {all && <option value="">Semua key</option>}
        {keys.map((k) => (
          <option key={k.id} value={k.id} disabled={Boolean(k.revokedAt)}>
            {k.name} · {k.preview}
            {k.revokedAt ? " (dicabut)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PageHead({ eyebrow, title, children, actions }) {
  return (
    <header className="dash-head">
      <div>
        <span className="dash-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="dash-head-actions">{actions}</div>}
    </header>
  );
}

const days = (ms) => Math.max(0, Math.ceil((ms - Date.now()) / 86400000));

// ---------- views ----------

function Overview({ account }) {
  const { data, error, loading, reload } = useApi("/overview");
  if (loading && !data) return <Loading rows={5} />;
  if (error) return <Failure error={error} onRetry={reload} />;
  const active = data.keys.filter((k) => !k.revokedAt);
  const { totals, series, routes, recent } = data.usage;
  const first = active[0];
  const sample = first
    ? first.preview.replace("…", "••••••••")
    : "jkc_KEY_KAMU";
  const curl = `# Lewat header (disarankan)\ncurl -H "X-API-Key: ${sample}" \\\n  ${BASE}/api/news?perpage=5\n\n# Atau lewat query\ncurl "${BASE}/api/news?perpage=5&apikey=${sample}"`;
  return (
    <>
      <PageHead
        eyebrow={"RINGKASAN · " + data.period}
        title={"Halo, " + account.name.split(" ")[0] + "."}
      >
        Kuota bulan ini direset dalam <b>{days(data.resetsAt)} hari</b> (
        {date(data.resetsAt)}).
      </PageHead>
      <div className="dash-hero">
        <div className="dash-hero-copy">
          <span className="dash-eyebrow">KUOTA BULAN INI · SEMUA KEY</span>
          <p className="dash-big">
            <span className="dash-num">{fmt(data.quota.used)}</span>
            <small>/ {fmt(data.quota.limit)} request</small>
          </p>
          <Meter used={data.quota.used} limit={data.quota.limit} cells={32} />
          <div className="dash-hero-actions">
            {active.length ? (
              <Link href="/dashboard/billing" className="dash-btn accent">
                <PixelIcon name="card" size={12} /> Upgrade / isi ulang
              </Link>
            ) : (
              <Link href="/dashboard/keys" className="dash-btn accent">
                <PixelIcon name="plus" size={12} /> Buat API key pertama
              </Link>
            )}
            <Link href="/dashboard/usage" className="dash-btn ghost-dark">
              Lihat analytics <Icon size={13} />
            </Link>
          </div>
        </div>
        <AsciiScene
          shape="cube"
          size={11}
          speed={0.3}
          zoom={0.95}
          className="dash-hero-ascii"
        />
      </div>
      <div className="dash-stats">
        <Stat
          icon="pulse"
          label="Request 30 hari"
          value={compact(totals.requests)}
          sub={fmt(totals.requests) + " total"}
        />
        <Stat
          icon="shield"
          label="Error rate"
          value={(totals.errorRate * 100).toFixed(1).replace(".", ",") + "%"}
          sub={fmt(totals.errors) + " respons 4xx/5xx"}
        />
        <Stat
          icon="clock"
          label="Rata-rata latensi"
          value={fmt(totals.avgMs) + " ms"}
          sub="dari edge Cloudflare"
        />
        <Stat
          icon="key"
          label="Key aktif"
          value={active.length}
          sub={data.keys.length - active.length + " dicabut"}
        />
      </div>
      <div className="dash-grid-2">
        <Panel
          title="Request per hari"
          icon="bars"
          className="span-2"
          id="ov-daily"
        >
          {totals.requests ? (
            <Columns series={series} value="requests" label="request" />
          ) : (
            <Empty title="Belum ada request bulan ini">
              Kirim request pertama dengan contoh di bawah.
            </Empty>
          )}
        </Panel>
        <Panel
          title="Endpoint teratas"
          icon="code"
          id="ov-routes"
          action={
            <Link href="/dashboard/usage" className="dash-link">
              Semua <Icon size={12} />
            </Link>
          }
        >
          <RouteTable routes={routes.slice(0, 5)} />
        </Panel>
        <Panel
          title="Request terakhir"
          icon="list"
          id="ov-recent"
          action={
            <Link href="/dashboard/logs" className="dash-link">
              Log lengkap <Icon size={12} />
            </Link>
          }
        >
          <LogTable
            rows={recent.slice(0, 6)}
            compactView
            onOpen={(id) => navigate("/dashboard/logs?open=" + id)}
          />
        </Panel>
        <Panel
          title="Mulai dalam 30 detik"
          icon="play"
          className="span-2"
          id="ov-start"
        >
          <div className="dash-start">
            <ol>
              <li className={active.length ? "done" : ""}>
                <b>Buat API key</b> di halaman{" "}
                <Link href="/dashboard/keys">API Keys</Link>.
              </li>
              <li>
                <b>Kirim key</b> lewat header <code>X-API-Key</code> atau query{" "}
                <code>?apikey=</code> di setiap request.
              </li>
              <li>
                <b>Pantau kuota</b> lewat header{" "}
                <code>X-RateLimit-Remaining</code>.
              </li>
            </ol>
            <CodeBlock code={curl} language="bash" />
          </div>
        </Panel>
      </div>
    </>
  );
}

function KeyReveal({ secret, onClose }) {
  const ref = useRef(),
    [saved, setSaved] = useState(false),
    motionEnabled = useMotionEnabled();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    if (motionEnabled)
      gsap.from(dialog, {
        y: 30,
        scale: 0.96,
        autoAlpha: 0,
        duration: 0.6,
        ease: "expo.out",
        clearProps: "all",
      });
  }, []);
  return (
    <dialog
      ref={ref}
      className="dash-dialog"
      onCancel={(e) => !saved && e.preventDefault()}
      onClose={onClose}
      aria-labelledby="reveal-title"
    >
      <span className="dash-eyebrow">KEY BARU · {secret.item.name}</span>
      <h2 id="reveal-title">Simpan key ini sekarang.</h2>
      <p>
        Demi keamanan, key lengkap hanya tampil sekali. Simpan di environment
        variable server, jangan di kode frontend.
      </p>
      <div className="dash-secret">
        <code>{secret.key}</code>
        <Copy text={secret.key} />
      </div>
      <CodeBlock
        code={`# .env\nJKT48CONNECT_API_KEY=${secret.key}`}
        language="bash"
      />
      <label className="dash-check">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
        />
        Saya sudah menyimpan key ini di tempat aman
      </label>
      <button
        type="button"
        className="dash-btn accent wide"
        disabled={!saved}
        onClick={() => ref.current.close()}
      >
        Selesai
      </button>
    </dialog>
  );
}

function KeyCard({ k, onChange }) {
  const [mode, setMode] = useState(""),
    [name, setName] = useState(k.name),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const act = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      setMode("");
      onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const revoked = Boolean(k.revokedAt);
  return (
    <article className={"dash-key " + (revoked ? "revoked" : "")}>
      <header>
        {mode === "rename" ? (
          <form
            className="dash-inline"
            onSubmit={(e) => {
              e.preventDefault();
              act(() =>
                api("/keys/" + k.id, { method: "PUT", body: { name } }),
              );
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              autoFocus
              aria-label="Nama key"
            />
            <button className="dash-btn" disabled={busy}>
              Simpan
            </button>
            <button
              type="button"
              className="dash-btn ghost"
              onClick={() => setMode("")}
            >
              Batal
            </button>
          </form>
        ) : (
          <h3>{k.name}</h3>
        )}
        <span className={"dash-plan " + k.plan}>
          {revoked ? "Dicabut" : k.planLabel}
        </span>
      </header>
      <code className="dash-key-preview">{k.preview}</code>
      {!revoked && (
        <>
          <div className="dash-key-usage">
            <span>
              <b className="dash-num">{fmt(k.used)}</b> / {fmt(k.limit)} request
            </span>
            <small>{fmt(k.remaining)} tersisa</small>
          </div>
          <Meter used={k.used} limit={k.limit} cells={24} />
        </>
      )}
      <dl className="dash-key-meta">
        <div>
          <dt>Kuota dasar</dt>
          <dd>{fmt(k.monthlyLimit)}/bln</dd>
        </div>
        <div>
          <dt>Isi ulang</dt>
          <dd>{k.bonus ? "+" + fmt(k.bonus) : "–"}</dd>
        </div>
        <div>
          <dt>{k.planExpiresAt ? "Paket sampai" : "Dibuat"}</dt>
          <dd>{date(k.planExpiresAt || k.createdAt)}</dd>
        </div>
        <div>
          <dt>Terakhir dipakai</dt>
          <dd>{ago(k.lastUsedAt)}</dd>
        </div>
      </dl>
      {error && <p className="dash-error">{error}</p>}
      {!revoked && (
        <footer>
          {mode === "revoke" ? (
            <>
              <span className="dash-warn">
                Request dengan key ini akan langsung ditolak.
              </span>
              <button
                type="button"
                className="dash-btn danger"
                disabled={busy}
                onClick={() =>
                  act(() => api("/keys/" + k.id, { method: "DELETE" }))
                }
              >
                Ya, cabut
              </button>
              <button
                type="button"
                className="dash-btn ghost"
                onClick={() => setMode("")}
              >
                Batal
              </button>
            </>
          ) : (
            <>
              <Link
                href={"/dashboard/billing?key=" + k.id}
                className="dash-btn"
              >
                <PixelIcon name="card" size={11} /> Upgrade
              </Link>
              <Link
                href={"/dashboard/usage?key=" + k.id}
                className="dash-btn ghost"
              >
                Analytics
              </Link>
              <button
                type="button"
                className="dash-btn ghost"
                onClick={() => setMode("rename")}
              >
                Ganti nama
              </button>
              <button
                type="button"
                className="dash-btn ghost danger-text"
                onClick={() => setMode("revoke")}
              >
                Cabut
              </button>
            </>
          )}
        </footer>
      )}
    </article>
  );
}

function Keys({ search }) {
  const { data, error, loading, reload } = useApi("/keys"),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [fail, setFail] = useState(""),
    [secret, setSecret] = useState(null),
    welcome = new URLSearchParams(search).get("welcome");
  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setFail("");
    try {
      const made = await api("/keys", {
        method: "POST",
        body: { name: name || "Key utama" },
      });
      setSecret(made);
      setName("");
      reload();
    } catch (err) {
      setFail(err.message);
    } finally {
      setBusy(false);
    }
  }
  const active = data?.keys.filter((k) => !k.revokedAt) || [],
    revoked = data?.keys.filter((k) => k.revokedAt) || [];
  return (
    <>
      <PageHead eyebrow="AKSES" title="API Keys">
        Setiap key punya kuota bulanan sendiri. Maksimal {data?.maxKeys ?? 3}{" "}
        key aktif per akun.
      </PageHead>
      {welcome && !active.length && (
        <div className="dash-banner">
          <PixelIcon name="key" size={16} />
          <div>
            <b>Akunmu siap!</b> Buat API key pertama untuk mulai memanggil API.
            Key Free berisi 1.000 request per bulan.
          </div>
        </div>
      )}
      <Panel className="dash-create" id="create-key">
        <form onSubmit={create} className="dash-create-form">
          <label>
            <span>Nama key baru</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="mis. Bot Discord, Website oshi"
            />
          </label>
          <button
            className="dash-btn accent"
            disabled={busy || active.length >= (data?.maxKeys ?? 3)}
          >
            <PixelIcon name="plus" size={12} />{" "}
            {busy ? "Membuat…" : "Buat API key"}
          </button>
        </form>
        {fail && <p className="dash-error">{fail}</p>}
      </Panel>
      {loading && !data ? (
        <Loading rows={3} />
      ) : error ? (
        <Failure error={error} onRetry={reload} />
      ) : !active.length ? (
        <Empty icon="key" title="Belum ada API key aktif">
          Beri nama lalu klik “Buat API key”.
        </Empty>
      ) : (
        <div className="dash-keys">
          {active.map((k) => (
            <KeyCard key={k.id} k={k} onChange={reload} />
          ))}
        </div>
      )}
      {revoked.length > 0 && (
        <details className="dash-revoked">
          <summary>{revoked.length} key dicabut</summary>
          <div className="dash-keys">
            {revoked.map((k) => (
              <KeyCard key={k.id} k={k} onChange={reload} />
            ))}
          </div>
        </details>
      )}
      {secret && <KeyReveal secret={secret} onClose={() => setSecret(null)} />}
    </>
  );
}

function Usage({ search }) {
  const initialKey = new URLSearchParams(search).get("key") || "";
  const [range, setRange] = useState(30),
    [key, setKey] = useState(initialKey);
  const keys = useApi("/keys");
  const { data, error, loading, reload } = useApi(
    `/usage?days=${range}${key ? "&key=" + key : ""}`,
  );
  return (
    <>
      <PageHead
        eyebrow="ANALYTICS"
        title="Analytics"
        actions={
          <div className="dash-filters">
            <Segmented
              label="Rentang waktu"
              value={range}
              onChange={setRange}
              options={[
                [7, "7 hari"],
                [30, "30 hari"],
                [90, "90 hari"],
              ]}
            />
            <KeySelect
              keys={keys.data?.keys || []}
              value={key}
              onChange={setKey}
            />
          </div>
        }
      >
        Pola pemakaian API key-mu: volume, error, latensi dan endpoint favorit.
      </PageHead>
      {loading && !data ? (
        <Loading rows={6} />
      ) : error ? (
        <Failure error={error} onRetry={reload} />
      ) : (
        <div className={"dash-fade " + (loading ? "busy" : "")}>
          <div className="dash-stats">
            <Stat
              icon="pulse"
              label="Total request"
              value={compact(data.totals.requests)}
              sub={`${range} hari terakhir`}
            />
            <Stat
              icon="bars"
              label="Rata-rata per hari"
              value={fmt(data.totals.requests / data.days)}
              sub="request/hari"
            />
            <Stat
              icon="shield"
              label="Error rate"
              value={
                (data.totals.errorRate * 100).toFixed(1).replace(".", ",") + "%"
              }
              sub={fmt(data.totals.errors) + " error"}
            />
            <Stat
              icon="clock"
              label="Latensi rata-rata"
              value={fmt(data.totals.avgMs) + " ms"}
              sub="waktu respons Worker"
            />
          </div>
          <div className="dash-grid-2">
            <Panel
              title="Request per hari"
              icon="bars"
              className="span-2"
              id="us-req"
            >
              <Columns series={data.series} value="requests" label="request" />
            </Panel>
            <Panel title="Error per hari" icon="shield" id="us-err">
              <Columns
                series={data.series}
                value="errors"
                label="error"
                height={140}
                tone="bad"
              />
            </Panel>
            <Panel title="Latensi rata-rata per hari" icon="clock" id="us-lat">
              <Columns
                series={data.series}
                value="avgMs"
                format={(v) => fmt(v)}
                label="ms"
                height={140}
                tone="ink"
              />
            </Panel>
            <Panel
              title="Status respons"
              icon="list"
              id="us-status"
              action={<small className="dash-note">7 hari</small>}
            >
              <StatusList statuses={data.statuses} />
            </Panel>
            <Panel
              title="Jam tersibuk"
              icon="clock"
              id="us-hours"
              action={<small className="dash-note">WIB</small>}
            >
              <HourMap hours={data.hours} />
            </Panel>
            <Panel
              title="Negara asal"
              icon="home"
              id="us-countries"
              action={<small className="dash-note">7 hari</small>}
            >
              <SourceList
                rows={data.sources.countries}
                render={(r) => (
                  <>
                    <b aria-hidden="true">{flag(r.value) || "🌐"}</b>{" "}
                    {countryName(r.value)}
                  </>
                )}
                onPick={(r) => navigate("/dashboard/logs?country=" + r.value)}
              />
            </Panel>
            <Panel
              title="IP teratas"
              icon="list"
              id="us-ips"
              action={<small className="dash-note">klik untuk log</small>}
            >
              <SourceList
                rows={data.sources.ips}
                render={(r) => (
                  <>
                    <b aria-hidden="true">{flag(r.country) || "🌐"}</b>{" "}
                    <code>{r.value}</code>
                    <small>
                      {[r.city, r.network].filter(Boolean).join(" · ")}
                    </small>
                  </>
                )}
                onPick={(r) =>
                  navigate("/dashboard/logs?ip=" + encodeURIComponent(r.value))
                }
              />
            </Panel>
            <Panel title="Client" icon="code" id="us-agents">
              <SourceList
                rows={data.sources.agents}
                render={(r) => (
                  <>
                    <b>{clientName(r.value)}</b>
                    <small className="dash-ua">{r.value}</small>
                  </>
                )}
              />
            </Panel>
            <Panel title="Origin & cara kirim key" icon="key" id="us-origins">
              <SourceList
                rows={data.sources.keySources}
                render={(r) =>
                  r.value === "query" ? (
                    <>
                      Query <code>?apikey=</code>
                    </>
                  ) : (
                    <>
                      Header <code>X-API-Key</code>
                    </>
                  )
                }
              />
              <div className="dash-gap" />
              <SourceList
                rows={data.sources.origins}
                render={(r) => <code className="dash-ua">{r.value}</code>}
                empty="Belum ada origin atau referer"
              />
            </Panel>
            <Panel
              title="Endpoint"
              icon="code"
              className="span-2"
              id="us-routes"
            >
              <RouteTable routes={data.routes} />
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}

function Logs({ search }) {
  const keys = useApi("/keys"),
    params = new URLSearchParams(search);
  const [status, setStatus] = useState(""),
    [key, setKey] = useState(params.get("key") || ""),
    [ip, setIp] = useState(params.get("ip") || ""),
    [country, setCountry] = useState(params.get("country") || ""),
    [open, setOpen] = useState(params.get("open") || null),
    [rows, setRows] = useState([]),
    [next, setNext] = useState(null),
    [live, setLive] = useState(false),
    [state, setState] = useState({ loading: true, error: null });
  const query = (before) =>
    "/logs?" +
    new URLSearchParams({
      ...(status && { status }),
      ...(key && { key }),
      ...(ip && { ip }),
      ...(country && { country }),
      ...(before && { before }),
    });
  async function load(before) {
    setState({ loading: true, error: null });
    try {
      const data = await api(query(before));
      setRows((r) => (before ? [...r, ...data.logs] : data.logs));
      setNext(data.next);
      setState({ loading: false, error: null });
    } catch (error) {
      setState({ loading: false, error });
    }
  }
  useEffect(() => {
    load();
  }, [status, key, ip, country]);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => !document.hidden && load(), 5000);
    return () => clearInterval(timer);
  }, [live, status, key, ip, country]);
  return (
    <>
      <PageHead
        eyebrow="OBSERVABILITY"
        title="Log request"
        actions={
          <div className="dash-filters">
            <Segmented
              label="Filter status"
              value={status}
              onChange={setStatus}
              options={[
                ["", "Semua"],
                ["2xx", "2xx"],
                ["4xx", "4xx"],
                ["429", "429"],
                ["5xx", "5xx"],
              ]}
            />
            <KeySelect
              keys={keys.data?.keys || []}
              value={key}
              onChange={setKey}
            />
            <button
              type="button"
              className={"dash-btn " + (live ? "live" : "ghost")}
              aria-pressed={live}
              onClick={() => setLive(!live)}
            >
              <i className="dash-live-dot" /> {live ? "Live" : "Live off"}
            </button>
          </div>
        }
      >
        Setiap request ber-API key tercatat 7 hari lengkap dengan asal (IP,
        lokasi, jaringan), client, header, cookie dan query. Klik baris untuk
        detail.
      </PageHead>
      {(ip || country) && (
        <div className="dash-active-filters">
          <span className="dash-eyebrow">FILTER</span>
          {ip && (
            <button type="button" className="fb-chip" onClick={() => setIp("")}>
              IP {ip} <Icon name="close" size={11} />
            </button>
          )}
          {country && (
            <button
              type="button"
              className="fb-chip"
              onClick={() => setCountry("")}
            >
              {flag(country)} {countryName(country)}{" "}
              <Icon name="close" size={11} />
            </button>
          )}
        </div>
      )}
      <Panel id="logs">
        {state.error ? (
          <Failure error={state.error} onRetry={() => load()} />
        ) : state.loading && !rows.length ? (
          <Loading rows={6} />
        ) : (
          <LogTable rows={rows} onOpen={setOpen} />
        )}
        {next && (
          <button
            type="button"
            className="dash-btn ghost wide"
            disabled={state.loading}
            onClick={() => load(next)}
          >
            {state.loading ? "Memuat…" : "Muat lebih lama"}
          </button>
        )}
      </Panel>
      {open && (
        <LogDrawer
          id={open}
          key={open}
          onClose={() => setOpen(null)}
          onFilter={(f) => {
            setOpen(null);
            if (f.ip) setIp(f.ip);
          }}
        />
      )}
    </>
  );
}

// Checkout lives on its own page, /pay/<id>: shareable, refresh-safe, and
// it keeps polling the gateway (through our server) until the bill settles.
function remaining(expiredAt, now) {
  if (!expiredAt) return null;
  const end = Date.parse(expiredAt.replace(" ", "T") + "+07:00");
  return Number.isFinite(end) ? Math.max(0, end - now) : null;
}
const clock = (ms) =>
  String(Math.floor(ms / 60000)).padStart(2, "0") +
  ":" +
  String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");

export function PayPage({ id }) {
  const account = useAccount(),
    motionEnabled = useMotionEnabled(),
    root = useRef(),
    [payment, setPayment] = useState(null),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (account === null) navigate("/login");
  }, [account]);
  useEffect(() => {
    document.title = "Pembayaran · JKT48Connect";
    if (!account) return;
    api("/payments/" + id)
      .then((d) => setPayment(d.payment))
      .catch(setError);
  }, [id, Boolean(account)]);
  const pending = payment?.status === "PENDING";
  useEffect(() => {
    if (!pending) return;
    const poll = setInterval(async () => {
      if (document.hidden) return;
      try {
        setPayment((await api("/payments/" + id)).payment);
      } catch (e) {
        setError(e);
      }
    }, 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [pending, id]);
  useEffect(() => {
    if (!motionEnabled || !payment || !root.current) return;
    const ctx = gsap.context(() => {
      gsap.from(".pay-summary, .pay-main > *", {
        y: 22,
        autoAlpha: 0,
        duration: 0.8,
        stagger: 0.06,
        ease: "expo.out",
        clearProps: "transform,opacity,visibility",
      });
    }, root);
    return () => ctx.revert();
  }, [payment?.status, motionEnabled]);
  async function cancel() {
    setBusy(true);
    try {
      setPayment(
        (await api("/payments/" + id + "/cancel", { method: "POST", body: {} }))
          .payment,
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  if (!account || (!payment && !error))
    return (
      <main id="main-content" className="dash-boot">
        <Loading rows={3} />
      </main>
    );
  if (!payment)
    return (
      <main id="main-content" className="dash-boot">
        <Failure error={error} />
        <p>
          <Link href="/dashboard/billing" className="dash-btn">
            Kembali ke tagihan
          </Link>
        </p>
      </main>
    );
  const left = remaining(payment.expiredAt, now),
    step = payment.status === "SUCCESS" ? 4 : pending ? 2 : 1;
  return (
    <main id="main-content" className="pay-page" ref={root}>
      <section className="pay-summary">
        <div className="pay-summary-top">
          <span className="dash-eyebrow">CHECKOUT · JKT48CONNECT</span>
          <span className={"dash-badge " + payment.status.toLowerCase()}>
            {STATUS_LABEL[payment.status] || payment.status}
          </span>
        </div>
        <h1>{payment.label}</h1>
        <p className="pay-for">
          <PixelIcon name="key" size={12} /> {payment.keyName}
        </p>
        <dl className="pay-lines">
          <div>
            <dt>Harga</dt>
            <dd>{rupiah(payment.baseAmount)}</dd>
          </div>
          <div>
            <dt>Kode unik</dt>
            <dd>{rupiah(payment.amount - payment.baseAmount)}</dd>
          </div>
          <div className="total">
            <dt>Total</dt>
            <dd className="dash-num">{rupiah(payment.amount)}</dd>
          </div>
        </dl>
        <AsciiScene
          shape="cube"
          size={10}
          speed={0.35}
          zoom={0.9}
          className="pay-ascii"
        />
        <p className="pay-ref">
          No. tagihan {payment.trxId}
          <br />
          Dibuat {time(payment.createdAt)} WIB
        </p>
        <Link href="/dashboard/billing" className="dash-btn ghost-dark">
          <Icon
            name="arrow"
            size={13}
            style={{ transform: "rotate(180deg)" }}
          />{" "}
          Kembali ke tagihan
        </Link>
      </section>
      <section className="pay-main">
        <ol className="pay-steps" aria-label="Tahap pembayaran">
          {["Tagihan dibuat", "Menunggu pembayaran", "Lunas"].map(
            (label, i) => (
              <li
                key={label}
                className={i + 1 < step ? "done" : i + 1 === step ? "now" : ""}
              >
                <i>{i + 1 < step ? "✓" : i + 1}</i>
                {label}
              </li>
            ),
          )}
        </ol>
        {payment.status === "SUCCESS" ? (
          <div className="dash-paid">
            <p className="dash-paid-word" aria-hidden="true">
              LUNAS
            </p>
            <p>
              <b>Pembayaran {rupiah(payment.amount)} diterima.</b>{" "}
              {payment.kind === "plan"
                ? "Paket sudah aktif di key " + payment.keyName + "."
                : "Kuota tambahan sudah masuk ke bulan ini."}
            </p>
            <div className="dash-row center">
              <Link href="/dashboard/keys" className="dash-btn accent">
                Lihat API key
              </Link>
              <Link href="/dashboard" className="dash-btn">
                Ke ringkasan
              </Link>
            </div>
          </div>
        ) : pending ? (
          <div className="pay-body">
            <div className="dash-qr big">
              {payment.qrImage ? (
                <img
                  src={payment.qrImage}
                  alt="Kode QRIS pembayaran"
                  width="280"
                  height="280"
                />
              ) : (
                <span>QR tidak tersedia, gunakan halaman bayar.</span>
              )}
              <i className="dash-qr-scan" aria-hidden="true" />
            </div>
            <div className="pay-info">
              <span className="dash-eyebrow">SCAN QRIS · TOTAL BAYAR</span>
              <p className="dash-big">
                <span className="dash-num">{rupiah(payment.amount)}</span>
              </p>
              <div className="dash-row">
                <Copy text={String(payment.amount)} label="Salin nominal" />
                {left != null && (
                  <span className={"pay-timer " + (left < 120000 ? "hot" : "")}>
                    <PixelIcon name="clock" size={11} /> {clock(left)} tersisa
                  </span>
                )}
              </div>
              <ol className="dash-steps">
                <li>Buka m-banking atau e-wallet, pilih bayar dengan QRIS.</li>
                <li>
                  Scan kode, pastikan nominal sama persis termasuk kode unik.
                </li>
                <li>Tetap di halaman ini, status diperbarui otomatis.</li>
              </ol>
              <p className="dash-waiting">
                <i className="dash-live-dot" /> Menunggu pembayaran…
              </p>
              <div className="dash-row">
                {payment.paymentUrl && (
                  <a
                    className="dash-btn"
                    href={payment.paymentUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Buka halaman bayar <Icon name="external" size={12} />
                  </a>
                )}
                <button
                  type="button"
                  className="dash-btn ghost danger-text"
                  disabled={busy}
                  onClick={cancel}
                >
                  Batalkan tagihan
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="dash-empty">
            <PixelIcon name="card" size={22} />
            <strong>
              Tagihan{" "}
              {payment.status === "EXPIRED" ? "kedaluwarsa" : "dibatalkan"}.
            </strong>
            <p>Tidak ada dana yang ditarik. Buat tagihan baru kapan saja.</p>
            <Link href="/dashboard/billing" className="dash-btn accent">
              Buat tagihan baru
            </Link>
          </div>
        )}
        {error && <p className="dash-error">{error.message}</p>}
        <p className="pay-secure">
          <PixelIcon name="shield" size={11} /> Pembayaran diproses gateway
          MYPG. JKT48Connect tidak menyimpan data bank atau e-wallet-mu.
        </p>
      </section>
    </main>
  );
}

const STATUS_LABEL = {
  PENDING: "Menunggu",
  SUCCESS: "Lunas",
  EXPIRED: "Kedaluwarsa",
  CANCELLED: "Dibatalkan",
};

function Billing({ search }) {
  const billing = useApi("/billing"),
    keys = useApi("/keys"),
    config = useApi("/config"),
    active = keys.data?.keys.filter((k) => !k.revokedAt) || [],
    [keyId, setKeyId] = useState(new URLSearchParams(search).get("key") || ""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [voucher, setVoucher] = useState(""),
    [voucherMsg, setVoucherMsg] = useState(null);
  useEffect(() => {
    if (!keyId && active[0]) setKeyId(active[0].id);
  }, [active.length]);
  const selected = active.find((k) => k.id === keyId);
  async function buy(product) {
    setBusy(product);
    setError("");
    try {
      const data = await api("/payments", {
        method: "POST",
        body: { product, keyId },
      });
      navigate("/pay/" + data.payment.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  async function redeem(e) {
    e.preventDefault();
    setVoucherMsg(null);
    try {
      const data = await api("/topup", {
        method: "POST",
        body: { code: voucher, keyId },
      });
      setVoucherMsg({
        ok: true,
        text: `+${fmt(data.requests)} request masuk ke kuota bulan ini.`,
      });
      setVoucher("");
      keys.reload();
    } catch (err) {
      setVoucherMsg({ ok: false, text: err.message });
    }
  }
  const products = billing.data?.products || [],
    plans = config.data?.plans || [],
    enabled = billing.data?.enabled;
  const planPrice = (id) =>
    products.find((p) => p.kind === "plan" && p.plan === id);
  return (
    <>
      <PageHead
        eyebrow="BILLING"
        title="Paket & tagihan"
        actions={
          <KeySelect
            keys={active}
            value={keyId}
            onChange={setKeyId}
            all={false}
            label="Berlaku untuk key"
          />
        }
      >
        Paket menaikkan kuota bulanan key selama 30 hari. Isi ulang menambah
        kuota untuk bulan berjalan. Bayar dengan QRIS.
      </PageHead>
      {!active.length && keys.data && (
        <div className="dash-banner">
          <PixelIcon name="key" size={16} />
          <div>
            Buat <Link href="/dashboard/keys">API key</Link> dulu sebelum
            membeli paket.
          </div>
        </div>
      )}
      {billing.data && !enabled && (
        <div className="dash-banner warn">
          <PixelIcon name="info" size={16} />
          <div>
            Pembayaran online belum aktif. Kamu tetap bisa memakai voucher isi
            ulang.
          </div>
        </div>
      )}
      {selected && (
        <div className="dash-current">
          <span className="dash-eyebrow">KEY TERPILIH</span>
          <b>{selected.name}</b>
          <span className={"dash-plan " + selected.plan}>
            {selected.planLabel}
          </span>
          <span>
            {fmt(selected.used)} / {fmt(selected.limit)} request bulan ini
          </span>
          {selected.planExpiresAt && (
            <span>· aktif sampai {date(selected.planExpiresAt)}</span>
          )}
        </div>
      )}
      {error && <p className="dash-error">{error}</p>}
      <div className="dash-plans">
        {plans.map((p) => {
          const product = planPrice(p.id),
            current = selected?.plan === p.id;
          return (
            <article
              key={p.id}
              className={"dash-plan-card " + p.id + (current ? " current" : "")}
            >
              <span className="dash-eyebrow">{p.label.toUpperCase()}</span>
              <p className="dash-price">
                {product ? (
                  <>
                    <span className="dash-num">{rupiah(product.price)}</span>
                    <small>/30 hari</small>
                  </>
                ) : (
                  <>
                    <span className="dash-num">Gratis</span>
                    {p.id === "fanbase" && <small>lewat pengajuan</small>}
                  </>
                )}
              </p>
              <ul>
                <li>
                  <b>{fmt(p.monthly)}</b> request/bulan
                </li>
                <li>Analytics & log 7 hari</li>
                <li>
                  {p.id === "free"
                    ? "Cocok untuk mencoba"
                    : p.id === "starter"
                      ? "Bot & website kecil"
                      : p.id === "fanbase"
                        ? "Khusus fanbase terverifikasi, tanpa batas waktu"
                        : "Aplikasi dengan banyak pengguna"}
                </li>
              </ul>
              {p.id === "fanbase" ? (
                <Link
                  href="/dashboard/fanbase"
                  className="dash-btn wide accent"
                >
                  <PixelIcon name="gift" size={11} />{" "}
                  {current ? "Lihat status" : "Ajukan program fanbase"}
                </Link>
              ) : product ? (
                <button
                  type="button"
                  className={
                    "dash-btn wide " + (p.id === "pro" ? "accent" : "")
                  }
                  disabled={!enabled || !selected || busy}
                  onClick={() => buy(product.id)}
                >
                  {busy === product.id
                    ? "Membuat tagihan…"
                    : current
                      ? "Perpanjang 30 hari"
                      : "Pilih " + p.label}
                </button>
              ) : (
                <span className="dash-plan-note">
                  {current ? "Paket aktif" : "Otomatis saat paket habis"}
                </span>
              )}
            </article>
          );
        })}
      </div>
      <div className="dash-grid-2">
        <Panel title="Isi ulang kuota" icon="plus" id="topups">
          <div className="dash-packs">
            {products
              .filter((p) => p.kind === "topup")
              .map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className="dash-pack"
                  disabled={!enabled || !selected || busy}
                  onClick={() => buy(p.id)}
                >
                  <b className="dash-num">+{compact(p.requests)}</b>
                  <span>request</span>
                  <em>{busy === p.id ? "…" : rupiah(p.price)}</em>
                </button>
              ))}
          </div>
          <p className="dash-note">
            Berlaku sampai akhir bulan berjalan (WIB), lalu kuota kembali ke
            batas paket.
          </p>
        </Panel>
        <Panel title="Punya voucher?" icon="gift" id="voucher">
          <form className="dash-create-form" onSubmit={redeem}>
            <label>
              <span>Kode voucher</span>
              <input
                value={voucher}
                onChange={(e) => setVoucher(e.target.value.toUpperCase())}
                placeholder="JKC-XXXX-XXXX-XXXX"
                maxLength={20}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button className="dash-btn" disabled={!voucher || !selected}>
              Tukar
            </button>
          </form>
          {voucherMsg && (
            <p className={voucherMsg.ok ? "dash-ok" : "dash-error"}>
              {voucherMsg.text}
            </p>
          )}
        </Panel>
        <Panel
          title="Riwayat tagihan"
          icon="card"
          className="span-2"
          id="invoices"
        >
          {billing.loading && !billing.data ? (
            <Loading />
          ) : billing.error ? (
            <Failure error={billing.error} onRetry={billing.reload} />
          ) : !billing.data.payments.length ? (
            <Empty icon="card" title="Belum ada tagihan" />
          ) : (
            <div className="dash-scroll">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>Tanggal</th>
                    <th>Item</th>
                    <th>Key</th>
                    <th>Nominal</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {billing.data.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{date(p.createdAt)}</td>
                      <td>
                        {p.label}
                        <br />
                        <small className="dash-note">{p.trxId}</small>
                      </td>
                      <td>{p.keyName}</td>
                      <td>{rupiah(p.amount)}</td>
                      <td>
                        <span
                          className={"dash-badge " + p.status.toLowerCase()}
                        >
                          {STATUS_LABEL[p.status] || p.status}
                        </span>
                      </td>
                      <td>
                        <Link
                          href={"/pay/" + p.id}
                          className={
                            "dash-btn " +
                            (p.status === "PENDING" ? "accent" : "ghost")
                          }
                        >
                          {p.status === "PENDING" ? "Bayar" : "Detail"}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

const FANBASE_KINDS = [
  ["member", "Fanbase member", "Fokus ke satu member (oshi)"],
  ["group", "Fanbase grup / tim", "JKT48 secara umum atau satu tim"],
  ["community", "Komunitas / proyek", "Komunitas, media, atau proyek fans"],
];
const APP_STATUS = {
  PENDING: [
    "Sedang ditinjau",
    "pending",
    "Tim kami memeriksa data dan akun X-mu. Biasanya 1–3 hari.",
  ],
  APPROVED: [
    "Disetujui",
    "success",
    "Paket Fanbase sudah aktif di API key pilihanmu.",
  ],
  REJECTED: [
    "Belum disetujui",
    "cancelled",
    "Perbaiki data sesuai catatan lalu ajukan lagi.",
  ],
};

function FormStep({ n, title, hint, children }) {
  return (
    <fieldset className="fb-step">
      <legend>
        <i>{String(n).padStart(2, "0")}</i>
        <span>
          <b>{title}</b>
          {hint && <small>{hint}</small>}
        </span>
      </legend>
      <div className="fb-fields">{children}</div>
    </fieldset>
  );
}
function Field({ label, wide, hint, children }) {
  return (
    <label className={"fb-field " + (wide ? "wide" : "")}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Fanbase() {
  const info = useApi("/fanbase"),
    keys = useApi("/keys"),
    listed = useApi("/fanbases"),
    active = keys.data?.keys.filter((k) => !k.revokedAt) || [],
    follow = info.data?.follow || "JKT48Connect",
    [f, setF] = useState({
      name: "",
      kind: "member",
      focus: "",
      founded: "",
      followers: "",
      x: "",
      instagram: "",
      tiktok: "",
      admin: "",
      contact: "",
      links: [""],
      usage: "",
      follower: "",
      follows: false,
      listing: null,
      agree: false,
      keyId: "",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!f.keyId && active[0]) setF((v) => ({ ...v, keyId: active[0].id }));
  }, [active.length]);
  const set = (key) => (e) =>
    setF((v) => ({
      ...v,
      [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));
  const app = info.data?.application,
    canApply = !app || app.status === "REJECTED";
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/fanbase", {
        method: "POST",
        body: {
          ...f,
          followers: Number(f.followers),
          links: f.links.filter(Boolean),
        },
      });
      info.reload();
      scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const status = app && APP_STATUS[app.status];
  return (
    <>
      <PageHead eyebrow="KOMUNITAS" title="Program fanbase">
        Fanbase JKT48 yang aktif bisa memakai paket <b>Fanbase gratis</b>:{" "}
        {fmt(info.data?.monthly || 50000)} request per bulan tanpa batas waktu.
        Isi formulir dengan lengkap, tim kami meninjau setiap pengajuan.
      </PageHead>
      {status && (
        <div className={"fb-status " + status[1]}>
          <span className={"dash-badge " + status[1]}>{status[0]}</span>
          <div>
            <b>{app.name}</b> · @{app.x}
            <small>
              Diajukan {date(app.createdAt)}
              {app.reviewedAt ? " · ditinjau " + date(app.reviewedAt) : ""}
            </small>
            <p>{status[2]}</p>
            {app.note && <p className="fb-note">Catatan admin: {app.note}</p>}
          </div>
        </div>
      )}
      <div className="fb-layout">
        {canApply ? (
          <form className="dash-panel fb-form" onSubmit={submit}>
            <FormStep
              n={1}
              title="Identitas fanbase"
              hint="Nama dan fokus fanbase seperti di media sosialmu."
            >
              <Field label="Nama fanbase" wide>
                <input
                  value={f.name}
                  onChange={set("name")}
                  maxLength={80}
                  required
                  placeholder="mis. Freya Indonesia"
                />
              </Field>
              <div
                className="fb-kinds wide"
                role="radiogroup"
                aria-label="Jenis fanbase"
              >
                {FANBASE_KINDS.map(([id, label, hint]) => (
                  <label
                    key={id}
                    className={"fb-kind " + (f.kind === id ? "on" : "")}
                  >
                    <input
                      type="radio"
                      name="kind"
                      value={id}
                      checked={f.kind === id}
                      onChange={set("kind")}
                    />
                    <b>{label}</b>
                    <small>{hint}</small>
                  </label>
                ))}
              </div>
              <Field label="Member / fokus fanbase">
                <input
                  value={f.focus}
                  onChange={set("focus")}
                  maxLength={80}
                  required
                  placeholder="mis. Freya Jayawardana"
                />
              </Field>
              <Field label="Berdiri sejak">
                <input
                  type="month"
                  value={f.founded}
                  onChange={set("founded")}
                  required
                  max={new Date().toISOString().slice(0, 7)}
                />
              </Field>
              <Field
                label="Perkiraan total pengikut"
                hint="Gabungan semua platform."
              >
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={f.followers}
                  onChange={set("followers")}
                  required
                  placeholder="mis. 12000"
                />
              </Field>
            </FormStep>
            <FormStep
              n={2}
              title="Akun & bukti keaslian"
              hint="Kami mengecek akun dan aktivitas terbaru fanbase."
            >
              <Field label="Akun X fanbase">
                <span className="fb-at">
                  <em>@</em>
                  <input
                    value={f.x}
                    onChange={set("x")}
                    maxLength={16}
                    required
                    placeholder="freyafanbase"
                    autoComplete="off"
                  />
                </span>
              </Field>
              <Field label="Instagram (opsional)">
                <span className="fb-at">
                  <em>@</em>
                  <input
                    value={f.instagram}
                    onChange={set("instagram")}
                    maxLength={31}
                    autoComplete="off"
                  />
                </span>
              </Field>
              <Field label="TikTok (opsional)">
                <span className="fb-at">
                  <em>@</em>
                  <input
                    value={f.tiktok}
                    onChange={set("tiktok")}
                    maxLength={31}
                    autoComplete="off"
                  />
                </span>
              </Field>
              <div className="fb-field wide">
                <span>Link bukti aktivitas (1–3)</span>
                {f.links.map((link, i) => (
                  <span className="fb-link" key={i}>
                    <input
                      type="url"
                      value={link}
                      required={i === 0}
                      placeholder="https://x.com/fanbase/status/…"
                      onChange={(e) =>
                        setF((v) => ({
                          ...v,
                          links: v.links.map((l, j) =>
                            j === i ? e.target.value : l,
                          ),
                        }))
                      }
                    />
                    {i > 0 && (
                      <button
                        type="button"
                        className="dash-btn ghost"
                        onClick={() =>
                          setF((v) => ({
                            ...v,
                            links: v.links.filter((_, j) => j !== i),
                          }))
                        }
                      >
                        Hapus
                      </button>
                    )}
                  </span>
                ))}
                {f.links.length < 3 && (
                  <button
                    type="button"
                    className="dash-btn ghost fb-add"
                    onClick={() =>
                      setF((v) => ({ ...v, links: [...v.links, ""] }))
                    }
                  >
                    <PixelIcon name="plus" size={11} /> Tambah link
                  </button>
                )}
                <small>
                  Contoh: postingan terbaru, event yang kalian adakan, atau
                  profil dengan jumlah pengikut.
                </small>
              </div>
            </FormStep>
            <FormStep
              n={3}
              title="Pengelola"
              hint="Hanya untuk admin JKT48Connect, tidak ditampilkan publik."
            >
              <Field label="Nama pengelola">
                <input
                  value={f.admin}
                  onChange={set("admin")}
                  maxLength={60}
                  required
                />
              </Field>
              <Field label="Kontak (WhatsApp, Telegram, atau email)">
                <input
                  value={f.contact}
                  onChange={set("contact")}
                  maxLength={100}
                  required
                />
              </Field>
            </FormStep>
            <FormStep
              n={4}
              title="Rencana penggunaan"
              hint="Ceritakan apa yang akan kalian bangun."
            >
              <Field
                label="Penggunaan API"
                wide
                hint={`${f.usage.trim().length}/1000 · minimal 30 karakter`}
              >
                <textarea
                  rows={4}
                  value={f.usage}
                  onChange={set("usage")}
                  maxLength={1000}
                  required
                  placeholder="mis. Bot Discord pengingat jadwal theater dan notifikasi live untuk anggota fanbase."
                />
              </Field>
              <KeySelect
                keys={active}
                value={f.keyId}
                onChange={(keyId) => setF((v) => ({ ...v, keyId }))}
                all={false}
                label="Key penerima paket"
              />
            </FormStep>
            <FormStep n={5} title="Verifikasi & persetujuan">
              <div className="fb-follow wide">
                <div>
                  <b>Wajib follow @{follow} di X</b>
                  <small>
                    Kami memeriksa username di bawah saat meninjau pengajuan.
                  </small>
                </div>
                <a
                  className="dash-btn accent"
                  href={"https://x.com/" + follow}
                  target="_blank"
                  rel="noreferrer"
                >
                  Follow @{follow} <Icon name="external" size={12} />
                </a>
              </div>
              <Field label="Username X yang mengikuti">
                <span className="fb-at">
                  <em>@</em>
                  <input
                    value={f.follower}
                    onChange={set("follower")}
                    maxLength={16}
                    required
                    autoComplete="off"
                  />
                </span>
              </Field>
              <label className="dash-check wide">
                <input
                  type="checkbox"
                  checked={f.follows}
                  onChange={set("follows")}
                />
                Saya sudah follow @{follow} di X
              </label>
              <div
                className="fb-kinds wide"
                role="radiogroup"
                aria-label="Pencantuman nama fanbase"
              >
                <label
                  className={"fb-kind " + (f.listing === true ? "on" : "")}
                >
                  <input
                    type="radio"
                    name="listing"
                    checked={f.listing === true}
                    onChange={() => setF((v) => ({ ...v, listing: true }))}
                  />
                  <b>Ya, cantumkan</b>
                  <small>
                    Nama dan akun X fanbase tampil di website docs JKT48Connect.
                  </small>
                </label>
                <label
                  className={"fb-kind " + (f.listing === false ? "on" : "")}
                >
                  <input
                    type="radio"
                    name="listing"
                    checked={f.listing === false}
                    onChange={() => setF((v) => ({ ...v, listing: false }))}
                  />
                  <b>Tidak usah</b>
                  <small>
                    Fanbase tetap mendapat paket, tanpa ditampilkan publik.
                  </small>
                </label>
              </div>
              {f.listing && f.name && (
                <p className="fb-preview wide">
                  Pratinjau di website:{" "}
                  <span className="fb-chip">
                    {f.name}
                    {f.x ? " · @" + f.x.replace(/^@/, "") : ""}
                  </span>
                </p>
              )}
              <label className="dash-check wide">
                <input
                  type="checkbox"
                  checked={f.agree}
                  onChange={set("agree")}
                />
                Data di atas benar, API dipakai untuk kegiatan fans
                non-komersial, dan saya setuju paket dapat dicabut jika
                disalahgunakan.
              </label>
            </FormStep>
            {error && <p className="dash-error">{error}</p>}
            <button
              className="auth-submit fb-submit"
              disabled={busy || !active.length || f.listing === null}
            >
              <span>
                {busy ? "Mengirim…" : app ? "Ajukan ulang" : "Kirim pengajuan"}
              </span>
              <span className="cta-arrow">
                <Icon size={14} />
              </span>
            </button>
            {!active.length && (
              <p className="dash-note">
                Buat <Link href="/dashboard/keys">API key</Link> dulu untuk
                menerima paket Fanbase.
              </p>
            )}
          </form>
        ) : (
          <Panel
            title="Detail pengajuan"
            icon="list"
            id="fb-detail"
            className="fb-form"
          >
            <dl className="dash-key-meta fb-detail">
              {[
                ["Jenis", app.details.kindLabel],
                ["Fokus", app.details.focus],
                ["Berdiri", app.details.founded],
                ["Pengikut", fmt(app.details.followers)],
                ["Pengelola", app.details.admin],
                ["Dicantumkan", app.listing ? "Ya" : "Tidak"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p className="dash-note">{app.details.usage}</p>
          </Panel>
        )}
        <aside className="fb-aside">
          <Panel title="Yang kamu dapat" icon="gift" id="fb-perks">
            <ul className="fb-perks">
              <li>
                <b>{fmt(info.data?.monthly || 50000)}</b> request per bulan
              </li>
              <li>Tanpa biaya dan tanpa batas waktu</li>
              <li>Analytics, log request, dan dukungan prioritas</li>
              <li>Opsional: nama fanbase tampil di website docs</li>
            </ul>
          </Panel>
          <Panel title="Fanbase terdaftar" icon="user" id="fb-listed">
            {listed.data?.fanbases.length ? (
              <div className="fb-chips">
                {listed.data.fanbases.map((x) => (
                  <a
                    key={x.name}
                    className="fb-chip"
                    href={"https://x.com/" + x.x}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {x.name}
                  </a>
                ))}
              </div>
            ) : (
              <Empty icon="user" title="Jadilah yang pertama">
                Fanbase yang disetujui dan setuju dicantumkan akan tampil di
                sini.
              </Empty>
            )}
          </Panel>
        </aside>
      </div>
    </>
  );
}

const PLAN_OPTIONS = [
  ["free", "Free"],
  ["starter", "Starter"],
  ["pro", "Pro"],
  ["fanbase", "Fanbase"],
];
const PRODUCT_LABEL = {
  "starter-30d": "Starter 30 hari",
  "pro-30d": "Pro 30 hari",
  "topup-5k": "+5.000 request",
  "topup-25k": "+25.000 request",
  "topup-100k": "+100.000 request",
};

// Admin tools talk to the dashboard API or the control API through `call`.
const dashboardAdmin = (path, options) => api("/admin" + path, options);
function useCall(call, path, deps = []) {
  const [state, setState] = useState({
      data: null,
      error: null,
      loading: true,
    }),
    [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    call(path)
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch(
        (error) => live && setState({ data: null, error, loading: false }),
      );
    return () => {
      live = false;
    };
  }, [path, tick, ...deps]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function FanbaseReview({ call = dashboardAdmin }) {
  const [status, setStatus] = useState("PENDING"),
    list = useCall(call, "/fanbase?status=" + status),
    [notes, setNotes] = useState({}),
    [msg, setMsg] = useState("");
  async function decide(id, decision) {
    setMsg("");
    try {
      await call("/fanbase/" + id, {
        method: "PUT",
        body: { status: decision, note: notes[id] || "" },
      });
      setMsg(
        decision === "APPROVED"
          ? "Fanbase disetujui, paket Fanbase aktif."
          : "Keputusan disimpan.",
      );
      list.reload();
    } catch (e) {
      setMsg(e.message);
    }
  }
  return (
    <Panel
      title="Pengajuan fanbase"
      icon="gift"
      className="span-2"
      id="admin-fanbase"
      action={
        <Segmented
          label="Status pengajuan"
          value={status}
          onChange={setStatus}
          options={[
            ["PENDING", "Menunggu"],
            ["APPROVED", "Disetujui"],
            ["REJECTED", "Ditolak"],
          ]}
        />
      }
    >
      {msg && <p className="dash-ok">{msg}</p>}
      {list.loading && !list.data ? (
        <Loading rows={2} />
      ) : !list.data?.applications.length ? (
        <Empty icon="gift" title="Tidak ada pengajuan di status ini" />
      ) : (
        <div className="admin-apps">
          {list.data.applications.map((a) => (
            <article key={a.id} className="admin-app">
              <header>
                <div>
                  <b>{a.name}</b>{" "}
                  <a
                    href={"https://x.com/" + a.x}
                    target="_blank"
                    rel="noreferrer"
                  >
                    @{a.x}
                  </a>
                  <small>
                    {a.details.kindLabel} · {a.details.focus} · sejak{" "}
                    {a.details.founded} · ±{fmt(a.details.followers)} pengikut
                  </small>
                </div>
                <span className={"dash-badge " + (a.listing ? "success" : "")}>
                  {a.listing ? "Boleh dicantumkan" : "Tidak dicantumkan"}
                </span>
              </header>
              <KV
                rows={[
                  [
                    "Follow X",
                    <a
                      href={"https://x.com/" + a.details.follower}
                      target="_blank"
                      rel="noreferrer"
                    >
                      @{a.details.follower}
                    </a>,
                  ],
                  [
                    "Instagram",
                    a.details.instagram && "@" + a.details.instagram,
                  ],
                  ["TikTok", a.details.tiktok && "@" + a.details.tiktok],
                  ["Pengelola", `${a.details.admin} · ${a.details.contact}`],
                  ["Akun", `${a.account.name} · ${a.account.email}`],
                  ["Key", <code>{a.key.preview}</code>],
                  [
                    "Bukti",
                    <span className="admin-links">
                      {a.details.links.map((l) => (
                        <a
                          key={l}
                          href={l}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {l.replace(/^https:\/\//, "").slice(0, 48)}
                        </a>
                      ))}
                    </span>,
                  ],
                  ["Rencana", a.details.usage],
                  ["Catatan", a.note],
                ]}
              />
              <footer>
                <input
                  value={notes[a.id] || ""}
                  onChange={(e) =>
                    setNotes((n) => ({ ...n, [a.id]: e.target.value }))
                  }
                  placeholder="Catatan untuk pemohon (opsional)"
                  maxLength={300}
                  aria-label="Catatan keputusan"
                />
                {a.status !== "APPROVED" && (
                  <button
                    type="button"
                    className="dash-btn accent"
                    onClick={() => decide(a.id, "APPROVED")}
                  >
                    Setujui
                  </button>
                )}
                {a.status !== "REJECTED" && (
                  <button
                    type="button"
                    className="dash-btn ghost danger-text"
                    onClick={() => decide(a.id, "REJECTED")}
                  >
                    {a.status === "APPROVED" ? "Cabut persetujuan" : "Tolak"}
                  </button>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function AdminPanel({
  account,
  call = dashboardAdmin,
  embedded = false,
}) {
  const [q, setQ] = useState(""),
    [query, setQuery] = useState(""),
    data = useCall(call, query ? "?q=" + encodeURIComponent(query) : ""),
    payments = useCall(call, "/payments"),
    [voucher, setVoucher] = useState({ requests: 5000, count: 1, note: "" }),
    [codes, setCodes] = useState(null),
    [msg, setMsg] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const t = data.data?.totals;
  async function act(fn, ok) {
    setMsg("");
    try {
      await fn();
      setMsg(ok);
      data.reload();
    } catch (e) {
      setMsg(e.message);
    }
  }
  return (
    <>
      {!embedded && (
        <PageHead
          eyebrow={"ADMIN · " + account.email}
          title="Admin"
          actions={
            <a className="dash-btn" href="/control/admin">
              <PixelIcon name="shield" size={11} /> Control panel{" "}
              <Icon name="external" size={12} />
            </a>
          }
        >
          Kelola akun developer, paket, voucher, pembayaran dan program fanbase.
          Pengaturan server lengkap ada di control panel.
        </PageHead>
      )}
      <div className="dash-stats six">
        <Stat icon="user" label="Akun" value={t ? fmt(t.accounts) : "–"} />
        <Stat icon="key" label="Key aktif" value={t ? fmt(t.keys) : "–"} />
        <Stat
          icon="pulse"
          label={"Request " + (data.data?.period || "")}
          value={t ? compact(t.requests) : "–"}
        />
        <Stat
          icon="card"
          label="Pendapatan bulan ini"
          value={t ? rupiah(t.revenue) : "–"}
          sub={t ? fmt(t.paidOrders) + " transaksi lunas" : ""}
        />
        <Stat
          icon="gift"
          label="Fanbase menunggu"
          value={t ? fmt(t.fanbasePending) : "–"}
        />
        <Stat
          icon="plus"
          label="Voucher aktif"
          value={t ? fmt(t.vouchers) : "–"}
        />
      </div>
      {msg && <p className="dash-ok">{msg}</p>}
      <div className="dash-grid-2">
        <FanbaseReview call={call} />
        <Panel
          title="Akun developer"
          icon="user"
          className="span-2"
          id="admin-accounts"
          action={
            <label className="dash-select">
              <span>Cari</span>
              <input
                className="admin-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="email atau nama"
              />
            </label>
          }
        >
          {data.loading && !data.data ? (
            <Loading rows={3} />
          ) : data.error ? (
            <Failure error={data.error} onRetry={data.reload} />
          ) : !data.data.accounts.length ? (
            <Empty icon="user" title="Belum ada akun" />
          ) : (
            <div className="dash-scroll">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>Akun</th>
                    <th>Key</th>
                    <th>Pemakaian</th>
                    <th>Paket</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.data.accounts.flatMap((a) =>
                    (a.keys.length ? a.keys : [null]).map((k, i) => (
                      <tr key={a.id + (k?.id || "")}>
                        {i === 0 && (
                          <td rowSpan={Math.max(1, a.keys.length)}>
                            <b>{a.name}</b>
                            <br />
                            <small className="dash-note">
                              {a.email} · daftar {date(a.created_at)}
                            </small>
                          </td>
                        )}
                        {k ? (
                          <>
                            <td>
                              {k.name}
                              <br />
                              <code className="dash-note">{k.preview}</code>
                              {k.revokedAt && (
                                <span className="dash-badge cancelled">
                                  dicabut
                                </span>
                              )}
                            </td>
                            <td>
                              {fmt(k.used)} / {fmt(k.limit)}
                              <Meter
                                used={k.used}
                                limit={k.limit}
                                cells={14}
                                label={false}
                              />
                            </td>
                            <td>
                              <select
                                className="admin-plan"
                                value={k.plan}
                                disabled={Boolean(k.revokedAt)}
                                onChange={(e) =>
                                  act(
                                    () =>
                                      call("/keys/" + k.id, {
                                        method: "PUT",
                                        body: { plan: e.target.value },
                                      }),
                                    "Paket " + k.name + " diperbarui.",
                                  )
                                }
                              >
                                {PLAN_OPTIONS.map(([id, label]) => (
                                  <option key={id} value={id}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="dash-btn ghost"
                                disabled={Boolean(k.revokedAt)}
                                onClick={() => {
                                  const value = prompt(
                                    "Tambah berapa request untuk bulan ini?",
                                    "5000",
                                  );
                                  if (value)
                                    act(
                                      () =>
                                        call("/keys/" + k.id + "/topup", {
                                          method: "POST",
                                          body: { requests: Number(value) },
                                        }),
                                      "Kuota ditambahkan.",
                                    );
                                }}
                              >
                                + Kuota
                              </button>
                            </td>
                          </>
                        ) : (
                          <td colSpan={4}>
                            <small className="dash-note">
                              Belum membuat key
                            </small>
                          </td>
                        )}
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Buat voucher isi ulang" icon="plus" id="admin-voucher">
          <form
            className="dash-form"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const d = await call("/vouchers", {
                  method: "POST",
                  body: {
                    ...voucher,
                    requests: Number(voucher.requests),
                    count: Number(voucher.count),
                  },
                });
                setCodes(d);
                data.reload();
              } catch (err) {
                setMsg(err.message);
              }
            }}
          >
            <label>
              <span>Request per voucher</span>
              <input
                type="number"
                min="1"
                value={voucher.requests}
                onChange={(e) =>
                  setVoucher({ ...voucher, requests: e.target.value })
                }
              />
            </label>
            <label>
              <span>Jumlah voucher</span>
              <input
                type="number"
                min="1"
                max="50"
                value={voucher.count}
                onChange={(e) =>
                  setVoucher({ ...voucher, count: e.target.value })
                }
              />
            </label>
            <label>
              <span>Catatan</span>
              <input
                value={voucher.note}
                maxLength={80}
                onChange={(e) =>
                  setVoucher({ ...voucher, note: e.target.value })
                }
                placeholder="mis. hadiah giveaway"
              />
            </label>
            <button className="dash-btn accent">Buat voucher</button>
          </form>
          {codes && (
            <div className="admin-codes">
              <p className="dash-note">
                Simpan sekarang, kode hanya tampil sekali ({fmt(codes.requests)}{" "}
                request per kode):
              </p>
              <pre>{codes.codes.join("\n")}</pre>
              <Copy text={codes.codes.join("\n")} label="Salin semua" />
            </div>
          )}
        </Panel>
        <Panel title="Pembayaran terbaru" icon="card" id="admin-payments">
          {!payments.data ? (
            <Loading rows={2} />
          ) : !payments.data.payments.length ? (
            <Empty icon="card" title="Belum ada pembayaran" />
          ) : (
            <ul className="admin-payments">
              {payments.data.payments.slice(0, 12).map((p) => (
                <li key={p.id}>
                  <div>
                    <b>{PRODUCT_LABEL[p.product] || p.product}</b>
                    <small>
                      {p.email} · {p.key} · {date(p.createdAt)}
                    </small>
                  </div>
                  <span>{rupiah(p.amount)}</span>
                  <span className={"dash-badge " + p.status.toLowerCase()}>
                    {STATUS_LABEL[p.status] || p.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

function device(ua = "") {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return browser + (os ? " · " + os : "");
}

function Account({ account }) {
  const sessions = useApi("/sessions"),
    [name, setName] = useState(account.name),
    [pass, setPass] = useState({ current: "", password: "" }),
    [remove, setRemove] = useState(""),
    [msg, setMsg] = useState({});
  const run = async (key, fn, ok) => {
    setMsg((m) => ({ ...m, [key]: null }));
    try {
      await fn();
      setMsg((m) => ({ ...m, [key]: { ok: true, text: ok } }));
    } catch (e) {
      setMsg((m) => ({ ...m, [key]: { ok: false, text: e.message } }));
    }
  };
  const note = (key) =>
    msg[key] && (
      <p className={msg[key].ok ? "dash-ok" : "dash-error"}>{msg[key].text}</p>
    );
  return (
    <>
      <PageHead eyebrow="AKUN" title="Pengaturan akun">
        Terdaftar sejak {date(account.createdAt)}.
      </PageHead>
      <div className="dash-grid-2">
        <Panel title="Profil" icon="user" id="profile">
          <form
            className="dash-form"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                "profile",
                async () => {
                  await api("/profile", { method: "PUT", body: { name } });
                  setAccount({ ...account, name });
                },
                "Nama diperbarui.",
              );
            }}
          >
            <label>
              <span>Nama</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
              />
            </label>
            <label>
              <span>Email</span>
              <input value={account.email} readOnly />
            </label>
            <button className="dash-btn">Simpan profil</button>
            {note("profile")}
          </form>
        </Panel>
        <Panel title="Ganti password" icon="shield" id="password">
          <form
            className="dash-form"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                "password",
                async () => {
                  await api("/password", { method: "PUT", body: pass });
                  setPass({ current: "", password: "" });
                  sessions.reload();
                },
                "Password diganti. Perangkat lain sudah dikeluarkan.",
              );
            }}
          >
            <label>
              <span>Password saat ini</span>
              <input
                type="password"
                autoComplete="current-password"
                value={pass.current}
                onChange={(e) => setPass({ ...pass, current: e.target.value })}
              />
            </label>
            <label>
              <span>Password baru</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={pass.password}
                onChange={(e) => setPass({ ...pass, password: e.target.value })}
              />
            </label>
            <button
              className="dash-btn"
              disabled={!pass.current || pass.password.length < 8}
            >
              Ganti password
            </button>
            {note("password")}
          </form>
        </Panel>
        <Panel
          title="Sesi aktif"
          icon="shield"
          className="span-2"
          id="sessions"
          action={
            <button
              type="button"
              className="dash-btn ghost"
              onClick={() =>
                run(
                  "sessions",
                  async () => {
                    await api("/sessions", { method: "DELETE" });
                    sessions.reload();
                  },
                  "Perangkat lain sudah dikeluarkan.",
                )
              }
            >
              Keluarkan perangkat lain
            </button>
          }
        >
          {sessions.data ? (
            <ul className="dash-sessions">
              {sessions.data.sessions.map((s) => (
                <li key={s.id}>
                  <PixelIcon name={s.current ? "user" : "shield"} size={14} />
                  <div>
                    <b>{device(s.userAgent)}</b>{" "}
                    {s.current && (
                      <span className="dash-badge success">Perangkat ini</span>
                    )}
                    <small>
                      Masuk {ago(s.createdAt)} · berakhir {date(s.expiresAt)}
                    </small>
                  </div>
                  {!s.current && (
                    <button
                      type="button"
                      className="dash-btn ghost"
                      onClick={() =>
                        api("/sessions/" + s.id, { method: "DELETE" }).then(
                          sessions.reload,
                        )
                      }
                    >
                      Keluarkan
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Loading rows={2} />
          )}
          {note("sessions")}
        </Panel>
        <Panel
          title="Zona berbahaya"
          icon="info"
          className="span-2 danger"
          id="danger"
        >
          <form
            className="dash-create-form"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                "delete",
                async () => {
                  await api("/account", {
                    method: "DELETE",
                    body: { password: remove },
                  });
                  setAccount(null);
                  navigate("/");
                },
                "",
              );
            }}
          >
            <p className="dash-note dash-full">
              Menghapus akun mencabut semua API key dan menghapus log. Tindakan
              ini tidak bisa dibatalkan.
            </p>
            <label>
              <span>Ketik password untuk konfirmasi</span>
              <input
                type="password"
                autoComplete="current-password"
                value={remove}
                onChange={(e) => setRemove(e.target.value)}
              />
            </label>
            <button className="dash-btn danger" disabled={!remove}>
              Hapus akun
            </button>
          </form>
          {note("delete")}
        </Panel>
      </div>
    </>
  );
}

// ---------- shell ----------

export function Dashboard({ path, search }) {
  const account = useAccount(),
    section = path.split("/")[2] || "",
    motionEnabled = useMotionEnabled(),
    nav = useRef(),
    main = useRef(),
    marker = useLiquid(nav, "a.on", [section, Boolean(account)], "y"),
    quota = useApi(account ? "/keys" : null, [section]);
  useEffect(() => {
    if (account === null) navigate("/login");
  }, [account]);
  useEffect(() => {
    const label = SECTIONS.find(([id]) => id === section)?.[1] || "Dashboard";
    document.title = label + " · Dashboard JKT48Connect";
  }, [section]);
  // Each view rises in panel by panel.
  useEffect(() => {
    if (!motionEnabled || !main.current || !account) return;
    const items = main.current.querySelectorAll(
      ".dash-head, .dash-hero, .dash-stat, .dash-panel, .dash-key, .dash-plan-card, .dash-banner, .dash-current",
    );
    const tween = gsap.from(items, {
      y: 18,
      autoAlpha: 0,
      duration: 0.7,
      stagger: 0.04,
      ease: "expo.out",
      clearProps: "transform,opacity,visibility",
    });
    return () => tween.revert();
  }, [section, Boolean(account), motionEnabled]);
  if (!account)
    return (
      <div className="dash-boot">
        <Loading rows={4} />
      </div>
    );
  const keys = quota.data?.keys.filter((k) => !k.revokedAt) || [];
  const used = keys.reduce((a, k) => a + k.used, 0),
    limit = keys.reduce((a, k) => a + k.limit, 0);
  const view =
    section === "keys" ? (
      <Keys search={search} />
    ) : section === "usage" ? (
      <Usage search={search} key={search} />
    ) : section === "logs" ? (
      <Logs search={search} key={search} />
    ) : section === "billing" ? (
      <Billing search={search} />
    ) : section === "admin" && account.admin ? (
      <AdminPanel account={account} />
    ) : section === "fanbase" ? (
      <Fanbase />
    ) : section === "account" ? (
      <Account account={account} />
    ) : (
      <Overview account={account} />
    );
  return (
    <div className="dash">
      <aside className="dash-side">
        <div className="dash-me">
          <span className="dash-avatar" aria-hidden="true">
            {account.name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <b>{account.name}</b>
            <small>{account.email}</small>
          </div>
        </div>
        <nav className="dash-nav" ref={nav} aria-label="Menu dashboard">
          <span className="dash-nav-pill" ref={marker} aria-hidden="true" />
          {[
            ...SECTIONS,
            ...(account.admin ? [["admin", "Admin", "shield"]] : []),
          ].map(([id, label, icon]) => (
            <Link
              key={id}
              href={"/dashboard" + (id ? "/" + id : "")}
              className={section === id ? "on" : ""}
              aria-current={section === id ? "page" : undefined}
            >
              <PixelIcon name={icon} size={12} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="dash-side-quota">
          <span className="dash-eyebrow">KUOTA BULAN INI</span>
          <b className="dash-num">{compact(used)}</b>
          <small>dari {compact(limit)} request</small>
          <Meter used={used} limit={limit || 1} cells={18} label={false} />
          <Link href="/dashboard/billing" className="dash-btn accent wide">
            <PixelIcon name="card" size={11} /> Upgrade
          </Link>
        </div>
        <button
          type="button"
          className="dash-logout"
          onClick={async () => {
            try {
              await api("/logout", { method: "POST", body: {} });
            } catch {}
            setAccount(null);
            navigate("/login");
          }}
        >
          <PixelIcon name="logout" size={12} /> Keluar
        </button>
      </aside>
      <main id="main-content" className="dash-main" ref={main} key={section}>
        {view}
      </main>
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMotionEnabled } from "./motion.js";
import { Copy, gsap, Icon, Link, useLiquid } from "./shared.jsx";
import { AsciiScene } from "./ascii-scene.jsx";
import { PixelIcon } from "./icons.jsx";
import { fmt, time, useAccount } from "./session.js";
import {
  AdminPanel,
  Empty,
  Failure,
  KV,
  Loading,
  PageHead,
  Panel,
  Segmented,
  Stat,
} from "./dashboard.jsx";

// The control panel: server settings, collector monitor, data operations and
// developer administration. Same shell as the dashboard; it speaks to
// /control/api with the session's CSRF token on every write.
let csrf = null;
async function ctl(path, { method = "GET", body } = {}) {
  const write = method !== "GET";
  const response = await fetch("/control/api/" + path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(write ? { "X-Requested-With": "jkt48connect" } : {}),
      ...(write && csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await response.json();
  } catch {}
  if (!response.ok)
    throw Object.assign(new Error(data.message || Object.entries(data.results || {}).filter(([, value]) => value?.error).map(([dataset, value]) => dataset + ": " + value.error).join("; ") || "HTTP " + response.status), {
      status: response.status,
    });
  return data;
}
const developerCall = (path, options) => ctl("developers" + path, options);

const SECTIONS = [
  ["", "Ringkasan", "grid"],
  ["collector", "Collector live", "live"],
  ["theater", "Theater YouTube", "live"],
  ["developers", "Developer API", "user"],
  ["licenses", "Lovable license", "key"],
  ["extension-notifications", "Notifikasi ekstensi", "list"],
  ["settings", "Pengaturan", "bars"],
  ["key", "Key server", "key"],
  ["data", "Data & cache", "list"],
];
const HEALTH_TEXT = {
  ok: "Berjalan",
  waiting: "Menunggu",
  warning: "Perlu dicek",
  error: "Gagal",
  stale: "Terlambat",
  disabled: "Nonaktif",
};
function Health({ value }) {
  if (!value) return null;
  return (
    <span className={"ctl-health " + value.status}>
      <i aria-hidden="true" />
      {value.message || HEALTH_TEXT[value.status] || value.status}
    </span>
  );
}
const uptime = (seconds = 0) =>
  seconds < 7200
    ? Math.floor(seconds / 60) + " menit"
    : seconds < 172800
      ? Math.floor(seconds / 3600) + " jam"
      : Math.floor(seconds / 86400) + " hari";
const when = (ms) => (ms ? time(ms) + " WIB" : "Belum ada");

function Login({ onDone }) {
  const [form, setForm] = useState({ email: "", password: "" }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await ctl("login", { method: "POST", body: form });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth ctl-login">
      <section className="auth-stage" aria-hidden="true">
        <div className="auth-stage-top">
          <span className="auth-stage-tag">CONTROL · PRIVATE</span>
        </div>
        <AsciiScene
          shape="torus"
          size={12}
          speed={0.35}
          zoom={1}
          className="auth-ascii"
        />
        <ul className="auth-perks">
          <li>
            <PixelIcon name="live" size={12} /> Pantau collector dan rekaman
            live
          </li>
          <li>
            <PixelIcon name="bars" size={12} /> Atur variable dan secret server
          </li>
          <li>
            <PixelIcon name="user" size={12} /> Kelola developer, paket dan
            fanbase
          </li>
        </ul>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="dash-eyebrow">ADMIN CONTROL</span>
          <h1 className="auth-title">
            Kontrol
            <br />
            <em>JKT48Connect.</em>
          </h1>
          <p className="auth-lead">
            Masuk dengan akun developer admin, atau dengan kredensial control
            server.
          </p>
          <a
            className="auth-submit ctl-dev-login"
            href="/login?next=/control/admin"
          >
            <span>Masuk dengan akun developer admin</span>
            <span className="cta-arrow">
              <Icon size={14} />
            </span>
          </a>
          <p className="ctl-or">
            <span>atau kredensial control</span>
          </p>
          <form className="auth-form" onSubmit={submit}>
            <label className="auth-field">
              <span className="auth-label">
                <PixelIcon name="news" size={11} /> Email
              </span>
              <input
                className="auth-input"
                type="email"
                autoComplete="username"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <label className="auth-field">
              <span className="auth-label">
                <PixelIcon name="shield" size={11} /> Password
              </span>
              <input
                className="auth-input"
                type="password"
                autoComplete="current-password"
                required
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </label>
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            <button className="dash-btn wide" disabled={busy}>
              {busy ? "Memeriksa…" : "Masuk ke control"}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

function useStatus(active) {
  const [state, setState] = useState({ data: null, error: null }),
    busy = useRef(false);
  const load = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      setState({ data: await ctl("status"), error: null, at: Date.now() });
    } catch (error) {
      setState((s) => ({ ...s, error }));
    } finally {
      busy.current = false;
    }
  };
  useEffect(() => {
    if (!active) return;
    load();
    const timer = setInterval(() => !document.hidden && load(), 15000);
    return () => clearInterval(timer);
  }, [active]);
  return { ...state, reload: load };
}

function Overview({ status, settings }) {
  const [result, setResult] = useState(null),
    [busy, setBusy] = useState("");
  const data = status.data;
  async function operation(name, path, body = {}, confirmText) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(name);
    setResult(null);
    try {
      setResult({ ok: true, data: await ctl(path, { method: "POST", body }) });
      status.reload();
    } catch (e) {
      setResult({ ok: false, data: e.message });
    } finally {
      setBusy("");
    }
  }
  if (!data)
    return status.error ? (
      <Failure error={status.error} onRetry={status.reload} />
    ) : (
      <Loading rows={4} />
    );
  const count = (name) =>
    data.collections
      .filter((c) => c.collection_name === name)
      .reduce((n, c) => n + c.records, 0);
  const m = data.monitor;
  const setting = (name) => settings?.find((s) => s.name === name)?.value;
  const active = m?.sessions.filter((s) => !s.completed) || [];
  const summary = (field, disabled) =>
    disabled
      ? { status: "disabled", message: "Dinonaktifkan" }
      : !m?.online
        ? { status: "stale", message: "Heartbeat VPS terlambat" }
        : !active.length
          ? { status: "waiting", message: "Menunggu live" }
          : active.some((s) =>
                ["error", "warning", "stale"].includes(s[field].status),
              )
            ? { status: "warning", message: "Perlu diperiksa per sesi" }
            : { status: "ok", message: "Berjalan" };
  return (
    <>
      <div className="dash-stats six">
        <Stat icon="user" label="Member" value={fmt(count("idolmembers"))} />
        <Stat icon="news" label="Berita" value={fmt(count("jkt48newnews"))} />
        <Stat
          icon="calendar"
          label="Jadwal"
          value={fmt(count("jkt48newschedules"))}
        />
        <Stat
          icon="image"
          label="Foto member R2"
          value={fmt(data.mediaObjects) + (data.mediaTruncated ? "+" : "")}
        />
        <Stat
          icon="camera"
          label="Screenshot R2"
          value={fmt(data.liveImages || 0)}
        />
        <Stat
          icon="replay"
          label="Video R2"
          value={fmt(data.liveVideos || 0)}
        />
      </div>
      <Panel
        title="Kesehatan pipeline"
        icon="pulse"
        id="ctl-health"
        action={
          <small className="dash-note">Diperbarui {when(status.at)}</small>
        }
      >
        <div className="ctl-pipeline">
          {[
            [
              "VPS collector",
              m
                ? {
                    status: !m.enabled ? "disabled" : m.online ? "ok" : "stale",
                    message: !m.enabled
                      ? "Dinonaktifkan"
                      : m.online
                        ? "Online"
                        : "Tidak ada heartbeat",
                  }
                : { status: "waiting", message: "Belum ada heartbeat" },
            ],
            [
              "Rekam live",
              m &&
                summary(
                  "record",
                  !m.enabled || setting("COLLECTOR_RECORD_VIDEO") === "false",
                ),
            ],
            [
              "Screenshot",
              m &&
                summary(
                  "screenshot",
                  !m.enabled || setting("DISABLE_SCREENSHOTS") === "true",
                ),
            ],
            ["Recent", m?.recent],
            [
              "Sinkron JKT48",
              {
                status: data.autoSync ? "ok" : "disabled",
                message: data.autoSync ? "Otomatis" : "Manual",
              },
            ],
            [
              "Scraper privat",
              {
                status: data.scraperConfigured ? "ok" : "warning",
                message: data.scraperConfigured
                  ? "Terkonfigurasi"
                  : "Belum siap",
              },
            ],
          ].map(([title, value]) => (
            <div key={title}>
              <span className="dash-eyebrow">{title}</span>
              <Health value={value} />
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Operasi" icon="play" id="ctl-ops">
        <div className="ctl-ops">
          <button
            type="button"
            className="dash-btn accent"
            disabled={Boolean(busy)}
            onClick={() => operation("sync", "sync", { dataset: "all" })}
          >
            <PixelIcon name="replay" size={11} />{" "}
            {busy === "sync" ? "Menyinkronkan…" : "Sinkronkan semua dataset"}
          </button>
          {["news", "schedules", "members"].map((d) => (
            <button
              key={d}
              type="button"
              className="dash-btn"
              disabled={Boolean(busy)}
              onClick={() => operation("sync-" + d, "sync", { dataset: d })}
            >
              {busy === "sync-" + d
                ? "…"
                : "Sinkron " +
                  { news: "berita", schedules: "jadwal", members: "member" }[d]}
            </button>
          ))}
          <button
            type="button"
            className="dash-btn"
            disabled={Boolean(busy)}
            onClick={() => operation("warm", "media/warm")}
          >
            {busy === "warm" ? "Menyimpan…" : "Simpan batch gambar ke R2"}
          </button>
          <button
            type="button"
            className="dash-btn ghost danger-text"
            disabled={Boolean(busy)}
            onClick={() =>
              operation(
                "cache",
                "cache/clear",
                {},
                "Hapus cache respons API? Data dan gambar R2 tetap tersimpan.",
              )
            }
          >
            Hapus cache API
          </button>
        </div>
        {result && (
          <pre className={"ctl-result " + (result.ok ? "" : "bad")}>
            {typeof result.data === "string"
              ? result.data
              : JSON.stringify(result.data, null, 2)}
          </pre>
        )}
      </Panel>
    </>
  );
}

function Collector({ status }) {
  const data = status.data;
  if (!data)
    return status.error ? (
      <Failure error={status.error} onRetry={status.reload} />
    ) : (
      <Loading rows={4} />
    );
  const m = data.monitor;
  return (
    <>
      <Panel
        title="Heartbeat VPS"
        icon="live"
        id="ctl-heartbeat"
        action={
          <button
            type="button"
            className="dash-btn ghost"
            onClick={status.reload}
          >
            Refresh
          </button>
        }
      >
        {m ? (
          <KV
            rows={[
              ["Heartbeat", when(m.lastSeen)],
              ["PID · uptime", `${m.pid || "—"} · ${uptime(m.uptimeSeconds)}`],
              ["Showroom", m.discovery?.showroom ? "OK" : "Gagal / nonaktif"],
              ["IDN", m.discovery?.idn ? "OK" : "Gagal / nonaktif"],
              [
                "Recent selesai · antrean",
                `${fmt(m.completedCount)} · ${fmt(m.pending)}`,
              ],
              ["Sinkron terakhir", when(m.lastArchive)],
              ["Live selesai terakhir", when(m.lastCompleted)],
              ["Kegagalan arsip", fmt(m.archiveErrors)],
              [
                "IDN auth",
                data.idnAuth?.configured
                  ? data.idnAuth.error
                    ? "Error: " + data.idnAuth.error
                    : "Refresh token terpasang · JWT " +
                      (data.idnAuth.ready ? "siap" : "menunggu")
                  : "Belum diisi, memakai akses publik",
              ],
            ]}
          />
        ) : (
          <Empty icon="live" title="Collector belum mengirim heartbeat" />
        )}
      </Panel>
      <Panel title="Sesi live" icon="camera" id="ctl-sessions">
        {!m?.sessions.length ? (
          <Empty icon="camera" title="Tidak ada sesi yang dipantau" />
        ) : (
          <div className="dash-scroll">
            <table className="dash-table ctl-live">
              <thead>
                <tr>
                  <th>Member / sesi</th>
                  <th>Rekam → R2</th>
                  <th>Screenshot</th>
                  <th>Chat / gold</th>
                  <th>Recent</th>
                </tr>
              </thead>
              <tbody>
                {m.sessions.map((s) => (
                  <tr key={s.data_id}>
                    <td>
                      <b>{s.name}</b>
                      <small>
                        {s.type} · {s.data_id}
                      </small>
                    </td>
                    <td>
                      <Health value={s.record} />
                      <small>
                        {(s.video.bytes / 1048576).toFixed(1)} MiB ·{" "}
                        {s.video.parts} part · {s.video.errors} gagal
                      </small>
                    </td>
                    <td>
                      <Health value={s.screenshot} />
                      <small>
                        {when(s.last_screenshot)}
                        {s.last_screenshot && (
                          <>
                            {" · "}
                            <a
                              href={`/media/live/${encodeURIComponent(s.data_id)}/${s.last_screenshot}.jpg`}
                              target="_blank"
                              rel="noopener"
                            >
                              buka
                            </a>
                          </>
                        )}
                      </small>
                    </td>
                    <td>
                      {s.type === "idn" ? (
                        <>
                          <Health value={s.ranking} />
                          <small>
                            {s.observed_events || 0} event ·{" "}
                            {s.reported_gold ?? "—"} gold IDN
                          </small>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <Health value={s.archive} />
                      <small>{s.completed ? "Selesai" : "Live"}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Arsip & replay" icon="replay" id="ctl-archive">
        {!data.collectorSessions?.length ? (
          <Empty icon="replay" title="Belum ada sesi terekam" />
        ) : (
          <div className="dash-scroll">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>Sesi</th>
                  <th>Status</th>
                  <th>Frame</th>
                  <th>Gift</th>
                  <th>Video</th>
                </tr>
              </thead>
              <tbody>
                {data.collectorSessions.map((s) => (
                  <tr key={s.data_id}>
                    <td>
                      <code>{s.data_id}</code>
                    </td>
                    <td>{s.status}</td>
                    <td>{fmt(s.frames)}</td>
                    <td>
                      {fmt(s.gifts)} {s.type === "idn" ? "gold" : "poin"}
                    </td>
                    <td className="ctl-replays">
                      {s.recordings.map((r, i) => (
                        <a
                          key={r.run}
                          href={`/replay/${encodeURIComponent(s.data_id)}/${encodeURIComponent(r.run)}`}
                          target="_blank"
                          rel="noopener"
                        >
                          MP4 {i + 1}
                          {r.partial ? " (parsial)" : ""}
                        </a>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function Settings({ settings, reload }) {
  const groups = useMemo(
      () => [...new Set(settings.map((s) => s.group))],
      [settings],
    ),
    [group, setGroup] = useState(groups[0]),
    [query, setQuery] = useState(""),
    [pending, setPending] = useState({}),
    [busy, setBusy] = useState(false),
    [msg, setMsg] = useState(null);
  const list = settings.filter((s) =>
    query
      ? (s.name + " " + s.description)
          .toLowerCase()
          .includes(query.toLowerCase())
      : s.group === group,
  );
  const changes = Object.keys(pending).length;
  async function save() {
    const sensitive = ["SECRET", "AUTH_SECRET", "JWT_SECRET", "API_KEY"].filter(
      (n) => n in pending,
    );
    if (
      sensitive.length &&
      !confirm(
        "Perubahan " +
          sensitive.join(", ") +
          " dapat membatalkan key atau token lama. Simpan?",
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const result = await ctl("settings", {
        method: "PUT",
        body: { changes: pending },
      });
      setPending({});
      setMsg({ ok: true, text: result.message });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ctl-settings">
      <aside className="dash-panel ctl-groups">
        <label className="fb-field">
          <span>Cari pengaturan</span>
          {/* Not a login form: keep password managers from filling the
              saved email into the search box. */}
          <input
            type="search"
            name="ctl-settings-filter"
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore=""
            data-form-type="other"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="apikey, scraper, origin…"
          />
        </label>
        <nav aria-label="Grup pengaturan">
          {groups.map((g) => (
            <button
              key={g}
              type="button"
              className={!query && g === group ? "on" : ""}
              onClick={() => (setQuery(""), setGroup(g))}
            >
              {g}
              <small>{settings.filter((s) => s.group === g).length}</small>
            </button>
          ))}
        </nav>
        <p className="dash-note">
          Secret tidak pernah ditampilkan. Field secret kosong saat menyimpan
          berarti nilai lama dipertahankan.
        </p>
      </aside>
      <div className="dash-panel ctl-fields">
        <header className="dash-panel-head">
          <h2>
            <PixelIcon name="bars" size={12} />{" "}
            {query ? "Hasil pencarian" : group}
          </h2>
          <button
            type="button"
            className="dash-btn accent"
            disabled={!changes || busy}
            onClick={save}
          >
            {busy
              ? "Menyimpan…"
              : changes
                ? `Simpan ${changes} perubahan`
                : "Tidak ada perubahan"}
          </button>
        </header>
        {msg && <p className={msg.ok ? "dash-ok" : "dash-error"}>{msg.text}</p>}
        {!list.length ? (
          <Empty icon="search" title="Tidak ada pengaturan yang cocok" />
        ) : (
          list.map((s) => {
            const changed = s.name in pending;
            return (
              <div
                key={s.name}
                className={"ctl-field " + (changed ? "changed" : "")}
              >
                <div className="ctl-field-head">
                  <code>{s.name}</code>
                  <span
                    className={
                      "dash-badge " +
                      (s.secret ? (s.configured ? "success" : "pending") : "")
                    }
                  >
                    {s.secret
                      ? s.configured
                        ? "Secret · terpasang"
                        : "Secret · kosong"
                      : "Variable"}
                  </span>
                </div>
                <p>{s.description}</p>
                <input
                  type={s.secret ? "password" : "text"}
                  name={"setting-" + s.name}
                  autoComplete={s.secret ? "new-password" : "off"}
                  data-lpignore="true"
                  data-1p-ignore=""
                  spellCheck={false}
                  value={changed ? (pending[s.name] ?? "") : s.value}
                  placeholder={
                    s.secret && s.configured
                      ? "Kosong = pertahankan secret aktif"
                      : "Masukkan nilai"
                  }
                  onChange={(e) => {
                    const value = e.target.value;
                    setPending((p) => {
                      const next = { ...p };
                      if (s.secret && !value) delete next[s.name];
                      else next[s.name] = value;
                      return next;
                    });
                  }}
                  aria-label={s.name}
                />
                <div className="ctl-field-foot">
                  <span>
                    Sumber:{" "}
                    {s.source === "control" ? "control panel" : "deployment"}
                    {changed ? " · belum disimpan" : ""}
                  </span>
                  {s.source === "control" && (
                    <button
                      type="button"
                      className="dash-link"
                      onClick={() =>
                        setPending((p) => ({ ...p, [s.name]: null }))
                      }
                    >
                      Kembali ke nilai deployment
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ServerKey() {
  const [key, setKey] = useState(""),
    [shown, setShown] = useState(false),
    [msg, setMsg] = useState(null);
  return (
    <Panel title="Key server" icon="key" id="ctl-key">
      <p className="dash-note">
        Key server membuka semua endpoint tanpa kuota, dipakai backend sendiri
        dan collector. Developer memakai API key dari dashboard.
      </p>
      <div className="dash-secret ctl-key">
        <code>
          {shown
            ? key || "Belum terpasang"
            : "••••••••••••••••••••••••••••••••"}
        </code>
        {shown && key && <Copy text={key} />}
      </div>
      <div className="dash-row">
        <button
          type="button"
          className="dash-btn"
          onClick={async () => {
            try {
              const d = await ctl("key");
              setKey(d.key || "");
              setShown(true);
            } catch (e) {
              setMsg({ ok: false, text: e.message });
            }
          }}
        >
          Tampilkan key aktif
        </button>
        {shown && (
          <button
            type="button"
            className="dash-btn ghost"
            onClick={() => setShown(false)}
          >
            Sembunyikan
          </button>
        )}
        <button
          type="button"
          className="dash-btn ghost danger-text"
          onClick={async () => {
            if (
              !confirm(
                "Buat key server baru? Key lama berhenti bekerja setelah disimpan.",
              )
            )
              return;
            try {
              const d = await ctl("key/new", { method: "POST", body: {} });
              await ctl("settings", {
                method: "PUT",
                body: { changes: { API_KEY: d.key } },
              });
              setKey(d.key);
              setShown(true);
              setMsg({
                ok: true,
                text: "Key server baru aktif. Perbarui backend yang memakainya.",
              });
            } catch (e) {
              setMsg({ ok: false, text: e.message });
            }
          }}
        >
          Rotasi key server
        </button>
      </div>
      {msg && <p className={msg.ok ? "dash-ok" : "dash-error"}>{msg.text}</p>}
    </Panel>
  );
}

function Data({ status }) {
  const data = status.data;
  if (!data) return <Loading rows={3} />;
  return (
    <Panel
      title="Koleksi data"
      icon="list"
      id="ctl-collections"
      action={
        <small className="dash-note">
          {fmt(data.cacheEntries)} entri cache
        </small>
      }
    >
      <div className="dash-scroll">
        <table className="dash-table">
          <thead>
            <tr>
              <th>Database</th>
              <th>Koleksi</th>
              <th>Record</th>
            </tr>
          </thead>
          <tbody>
            {data.collections.map((c) => (
              <tr key={c.database_name + c.collection_name}>
                <td>{c.database_name}</td>
                <td>
                  <code>{c.collection_name}</code>
                </td>
                <td>{fmt(c.records)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ExtensionNotifications() {
  const empty=()=>({id:null,title:'',message:'',link:'',published:false});
  const [items,setItems]=useState(null),[form,setForm]=useState(empty),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
  const load=async()=>{const data=await ctl('extension-notifications');setItems(data.notifications)};
  useEffect(()=>{load().catch(e=>setError(e.message))},[]);
  const change=(name,value)=>setForm(f=>({...f,[name]:value}));
  async function save(e){
    e.preventDefault();setBusy(true);setError('');setSuccess('');
    try{await ctl('extension-notifications',{method:form.id?'PUT':'POST',body:form});await load();setSuccess(form.published?'Informasi diterbitkan. Ekstensi memperbarui notifikasi sekitar 30 detik saat online.':'Draft disimpan. Informasi ini belum ditampilkan di ekstensi.');setForm(empty())}
    catch(e){setError(e.message)}finally{setBusy(false)}
  }
  async function remove(item){
    if(!confirm('Hapus notifikasi “'+item.title+'”?'))return;
    setBusy(true);setError('');setSuccess('');
    try{await ctl('extension-notifications',{method:'DELETE',body:{id:item.id}});await load();if(form.id===item.id)setForm(empty());setSuccess('Notifikasi dihapus.')}
    catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <>
    {error&&<p role="alert" className="dash-error">{error}</p>}
    {success&&<p role="status" className="dash-note">{success}</p>}
    <div className="dash-grid-2">
      <Panel title={form.id?'Edit informasi':'Tulis informasi baru'} icon="plus">
        <p className="dash-note">Informasi yang diterbitkan muncul di menu notifikasi VALZY Studio v6.0.1. Draft hanya terlihat oleh admin.</p>
        <form className="dash-form ctl-notice-form" onSubmit={save}>
          <label><span>Judul</span><input required maxLength={160} value={form.title} onChange={e=>change('title',e.target.value)} placeholder="Informasi terbaru untuk pengguna"/></label>
          <label><span>Isi informasi</span><textarea required maxLength={5000} rows={7} value={form.message} onChange={e=>change('message',e.target.value)} placeholder="Tulis informasi yang akan dibaca pengguna…"/></label>
          <label><span>Tautan HTTPS · opsional</span><input type="url" pattern="https://.*" maxLength={2000} value={form.link} onChange={e=>change('link',e.target.value)} placeholder="https://…"/></label>
          <label className="ctl-notice-publish"><input type="checkbox" checked={form.published} onChange={e=>change('published',e.target.checked)}/><span>Terbitkan di ekstensi</span></label>
          <div className="ctl-notice-actions"><button className="dash-btn primary" disabled={busy}>{busy?'Menyimpan…':form.published?'Simpan & terbitkan':'Simpan draft'}</button>{form.id&&<button type="button" className="dash-btn" disabled={busy} onClick={()=>setForm(empty())}>Batal edit</button>}</div>
        </form>
      </Panel>
      <Panel title="Pratinjau notifikasi" icon="list">
        <div className="ctl-notice-preview"><span className="dash-eyebrow">{form.published?'AKAN DITERBITKAN':'DRAFT · BELUM TERBIT'}</span><h3>{form.title||'Judul informasi Anda'}</h3><p>{form.message||'Isi informasi akan terlihat di sini.'}</p>{form.link.startsWith('https://')&&<a href={form.link} target="_blank" rel="noopener noreferrer" className="dash-btn">Buka tautan ↗</a>}<small>{new Date().toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta'})}</small></div>
        <p className="dash-note">Pesan ditampilkan sebagai teks. Judul, isi dan tautan mengikuti format notifikasi ekstensi; status telah dibaca tetap disimpan di perangkat pengguna.</p>
      </Panel>
    </div>
    <Panel title="Informasi tersimpan" icon="list">
      {!items?<Loading rows={3}/>:!items.length?<p className="dash-note">Belum ada informasi. Buat draft atau terbitkan informasi pertama melalui formulir di atas.</p>:<div className="dash-table-wrap"><table className="dash-table"><thead><tr><th>Informasi</th><th>Status</th><th>Diperbarui · WIB</th><th>Tindakan</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td><b>{item.title}</b><p className="ctl-notice-excerpt">{item.message}</p></td><td>{item.published?'Terbit':'Draft'}</td><td>{new Date(item.updated_at).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})}</td><td><div className="ctl-notice-actions"><button className="dash-btn" disabled={busy} onClick={()=>{setForm({...item});setError('');setSuccess('');window.scrollTo({top:0,behavior:'smooth'})}}>Edit</button><button className="dash-btn danger-text" disabled={busy} onClick={()=>remove(item)}>Hapus</button></div></td></tr>)}</tbody></table></div>}
    </Panel>
  </>;
}

function LicensePanel() {
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState(null);
  const [form,setForm]=useState({plan:'Trial',email:'',durationValue:1,durationUnit:'month',maxActivations:5}),[prefix,setPrefix]=useState('VALZY'),[secret,setSecret]=useState('');
  const requestId=useRef(crypto.randomUUID());
  const load=()=>ctl('licenses').then(d=>{setData(d);setPrefix(d.prefix)}).catch(e=>setError(e.message));
  useEffect(()=>{load()},[]);
  const change=(name,value)=>{setForm(f=>({...f,[name]:value}));requestId.current=crypto.randomUUID();setResult(null)};
  return <>
    <Panel title="Konfigurasi lisensi" icon="key">
      <p className="dash-note">API key hanya tersimpan terenkripsi di server. Prefix baru berlaku untuk lisensi berikutnya; lisensi lama tetap aktif.</p>
      <form className="dash-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await ctl('settings',{method:'PUT',body:{changes:{LOVABLE_LICENSE_PREFIX:prefix,...(secret?{LOVABLE_LICENSE_API_KEY:secret}:{})}}});setSecret('');await load();requestId.current=crypto.randomUUID()}catch(e){setError(e.message)}finally{setBusy(false)}}}>
        <label><span>Prefix</span><input value={prefix} pattern="[A-Z][A-Z0-9]{1,15}" maxLength={16} required onChange={e=>setPrefix(e.target.value.toUpperCase())}/></label>
        <label><span>API key penyedia {data?.configured?'· tersimpan':'· belum tersimpan'}</span><input type="password" autoComplete="new-password" value={secret} placeholder="Isi hanya untuk mengganti" onChange={e=>setSecret(e.target.value)}/></label>
        <button className="dash-btn" disabled={busy}>Simpan konfigurasi</button>
      </form>
    </Panel>
    <Panel title="Buat lisensi Lovable" icon="plus">
      <form className="dash-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');setResult(null);try{const r=await ctl('licenses/generate',{method:'POST',body:{...form,requestId:requestId.current}});setResult(r);await load()}catch(e){setError(e.message)}finally{setBusy(false)}}}>
        <label><span>Paket</span><select value={form.plan} onChange={e=>change('plan',e.target.value)}><option>Trial</option><option>Pro</option></select></label>
        <label><span>Email opsional</span><input type="email" value={form.email} onChange={e=>change('email',e.target.value)}/></label>
        {form.plan==='Pro'&&<><label><span>Durasi</span><input type="number" min="1" max={form.durationUnit==='year'?10:10000} required value={form.durationValue} onChange={e=>change('durationValue',Number(e.target.value))}/></label><label><span>Satuan</span><select value={form.durationUnit} onChange={e=>change('durationUnit',e.target.value)}>{[['minute','Menit'],['hour','Jam'],['day','Hari'],['week','Minggu'],['month','Bulan'],['year','Tahun (12 bulan)']].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label></>}
        <label><span>Maksimal perangkat</span><input type="number" min="1" max="100" required value={form.maxActivations} onChange={e=>change('maxActivations',Number(e.target.value))}/></label>
        <p className="dash-note">Trial berlaku 30 menit sesuai penyedia. Tanggal kedaluwarsa selalu mengikuti respons penyedia.</p>
        <button className="dash-btn primary" disabled={busy||!data?.configured||Boolean(result)}>{busy?'Memproses…':'Buat lisensi'}</button>
        {result&&<button type="button" className="dash-btn" onClick={()=>{requestId.current=crypto.randomUUID();setResult(null)}}>Siapkan lisensi berikutnya</button>}
      </form>
      {error&&<p role="alert" className="dash-error">{error}</p>}
      {result&&<div className="dash-codes"><p>Simpan kode ini untuk pelanggan. Riwayat hanya menampilkan kode tersamarkan.</p><code style={{overflowWrap:'anywhere'}}>{result.license_key}</code><button className="dash-btn" onClick={()=>navigator.clipboard.writeText(result.license_key)}>Salin lisensi</button><p>{result.plan} · berakhir {new Date(result.expires_at).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})} WIB</p></div>}
    </Panel>
    <Panel title="50 pembuatan terakhir" icon="list"><div className="dash-table-wrap"><table className="dash-table"><thead><tr><th>Lisensi</th><th>Paket</th><th>Email</th><th>Durasi</th><th>Perangkat</th><th>Status</th><th>Berakhir</th></tr></thead><tbody>{data?.licenses?.map(l=><tr key={l.id}><td>{l.key_hint||'—'}</td><td>{l.plan}</td><td>{l.email||'—'}</td><td>{l.duration_value?l.duration_value+' '+l.duration_unit:'30 menit'}</td><td>{l.max_activations}</td><td>{l.state}</td><td>{l.expires_at?new Date(l.expires_at).toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta'}):'—'}</td></tr>)}</tbody></table></div></Panel>
  </>;
}

function TheaterRecorder({status}) {
  if(!status.data)return <Loading rows={3}/>;
  const health=status.data.theaterRecorder,rows=status.data.theaterRecordings||[],online=health&&Date.now()-health.lastSeen<120000;
  return <>
    <Panel title="Theater → YouTube" icon="live">
      <p className="dash-note">Rekaman video diunggah ke YouTube. Screenshot disimpan di R2 dan satu gambar menjadi thumbnail. Resolver menggunakan slug 14 Mei sesuai konfigurasi.</p>
      <KV rows={[["Service",online?'Online':'Belum terhubung / terlambat'],["OAuth YouTube",health?.auth_status==='ready'?'Siap':health?.auth_error||'Menunggu'],["Deteksi theater",health?.discovery_ok?'Berjalan':'Menunggu / perlu dicek'],["Sedang direkam",String(health?.active||0)],["Antrean upload",String(health?.queued||0)],["Ruang kosong VPS",health?((health.disk_free_bytes||0)/1024**3).toFixed(1)+' GB':'—'],["Masalah terakhir",health?.last_error||'—']]}/>
      <p className="dash-note">Data hasil tersedia melalui <code>/api/theater/recordings</code>. Rekaman ditandai parsial bila terlambat mulai atau koneksi terputus.</p>
    </Panel>
    <Panel title="Rekaman theater" icon="list">
      {!rows.length?<p className="dash-note">Belum ada rekaman. Service menunggu theater berstatus live.</p>:rows.map(r=><article key={r.id} style={{padding:'20px 0',borderBottom:'1px solid var(--line)'}}>
        <h3>{r.title}</h3><p>{r.theater_code||r.slug} · {r.status}{r.youtube_privacy?' · '+r.youtube_privacy:''}{r.partial?' · parsial':''}</p>
        <p className="dash-note">Mulai {new Date(r.started_at).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})} WIB · {Math.floor(r.duration_ms/60000)} menit · {r.screenshots.length} screenshot{r.error?' · '+r.error:''}</p>
        {r.youtube_url&&<a className="dash-btn" href={r.youtube_url} target="_blank" rel="noreferrer">Buka rekaman YouTube ↗</a>}
        <div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:14}}>{[...new Set([0,Math.floor(r.screenshots.length/2),r.screenshots.length-1])].filter(i=>r.screenshots[i]).map(i=><a key={i} href={r.screenshots[i].url} target="_blank" rel="noreferrer"><img src={r.screenshots[i].url} alt={'Screenshot '+(i+1)} loading="lazy" style={{width:180,maxWidth:'100%',borderRadius:12}}/></a>)}</div>
      </article>)}
    </Panel>
  </>;
}

export function ControlPanel({ search }) {
  const account = useAccount(),
    motionEnabled = useMotionEnabled(),
    [session, setSession] = useState(undefined),
    tab = new URLSearchParams(search).get("tab") || "",
    section = SECTIONS.some(([id]) => id === tab) ? tab : "",
    [settings, setSettings] = useState(null),
    [tick, setTick] = useState(0),
    nav = useRef(),
    main = useRef(),
    marker = useLiquid(nav, "a.on", [section, Boolean(session)], "y");
  useEffect(() => {
    document.title = "Control · JKT48Connect";
    ctl("session")
      .then((s) => {
        csrf = s.csrf;
        setSession(s);
      })
      .catch(() => setSession(null));
  }, [tick, account?.id]);
  useEffect(() => {
    if (!session) return;
    ctl("settings")
      .then((d) => setSettings(d.settings))
      .catch(() => setSettings([]));
  }, [session, tick]);
  const status = useStatus(
    Boolean(session) && ["", "collector", "theater", "data"].includes(section),
  );
  useEffect(() => {
    if (!motionEnabled || !main.current || !session) return;
    const tween = gsap.from(
      main.current.querySelectorAll(".dash-head, .dash-stat, .dash-panel"),
      {
        y: 16,
        autoAlpha: 0,
        duration: 0.6,
        stagger: 0.04,
        ease: "expo.out",
        clearProps: "transform,opacity,visibility",
      },
    );
    return () => tween.revert();
  }, [section, Boolean(session), motionEnabled]);
  if (session === undefined)
    return (
      <main id="main-content" className="dash-boot">
        <Loading rows={3} />
      </main>
    );
  if (!session)
    return (
      <main id="main-content" className="auth-main">
        <Login onDone={() => setTick((t) => t + 1)} />
      </main>
    );
  const title = SECTIONS.find(([id]) => id === section)?.[1];
  return (
    <div className="dash">
      <aside className="dash-side">
        <div className="dash-me">
          <span className="dash-avatar ctl" aria-hidden="true">
            <PixelIcon name="shield" size={18} />
          </span>
          <div>
            <b>Control panel</b>
            <small>{session.email}</small>
          </div>
        </div>
        <nav className="dash-nav" ref={nav} aria-label="Menu control">
          <span className="dash-nav-pill" ref={marker} aria-hidden="true" />
          {SECTIONS.map(([id, label, icon]) => (
            <Link
              key={id}
              href={"/control/admin" + (id ? "?tab=" + id : "")}
              className={section === id ? "on" : ""}
              aria-current={section === id ? "page" : undefined}
            >
              <PixelIcon name={icon} size={12} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="dash-side-quota ctl-side">
          <span className="dash-eyebrow">MASUK SEBAGAI</span>
          <b>
            {session.developer ? "Akun developer admin" : "Kredensial control"}
          </b>
          <Link href="/dashboard" className="dash-btn wide">
            <PixelIcon name="grid" size={11} /> Dashboard developer
          </Link>
        </div>
        <button
          type="button"
          className="dash-logout"
          onClick={async () => {
            try {
              await ctl("logout", { method: "POST", body: {} });
            } catch {}
            csrf = null;
            location.assign(session.developer ? "/login" : "/control/admin");
          }}
        >
          <PixelIcon name="logout" size={12} /> Keluar
        </button>
      </aside>
      <main id="main-content" className="dash-main" ref={main} key={section}>
        <PageHead eyebrow={"CONTROL · " + session.email} title={title}>
          {
            {
              "": "Kesehatan layanan, data, dan operasi cepat.",
              collector:
                "Heartbeat VPS, rekaman live, screenshot dan arsip replay.",
              theater: "Rekaman, screenshot, antrean unggahan dan URL YouTube theater.",
              developers:
                "Akun developer, paket, kuota, voucher, pembayaran dan program fanbase.",
              settings:
                "Variable dan secret server. Perubahan berlaku di semua instance dalam 10 detik.",
              licenses: "Pembuatan lisensi, prefix, durasi dan batas perangkat.",
              "extension-notifications": "Tulis, pratinjau dan terbitkan informasi untuk pengguna ekstensi.",
              key: "Key server untuk backend sendiri.",
              data: "Isi database dan cache respons.",
            }[section]
          }
        </PageHead>
        {section === "" && <Overview status={status} settings={settings} />}
        {section === "collector" && <Collector status={status} />}
        {section === "theater" && <TheaterRecorder status={status} />}
        {section === "developers" && (
          <AdminPanel call={developerCall} embedded />
        )}
        {section === "settings" &&
          (settings ? (
            <Settings
              settings={settings}
              reload={() => setTick((t) => t + 1)}
            />
          ) : (
            <Loading rows={4} />
          ))}
        {section === "licenses" && <LicensePanel />}
        {section === "extension-notifications" && <ExtensionNotifications />}
        {section === "key" && <ServerKey />}
        {section === "data" && <Data status={status} />}
      </main>
    </div>
  );
}

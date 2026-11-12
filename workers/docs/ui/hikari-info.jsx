import React, { useEffect, useRef, useState } from "react";
import { Failure, Loading, Panel } from "./dashboard.jsx";

const empty = () => ({ title: "", body: "", image: "", url: "", published: false, pinned: false });

export function HikariInformation({ call }) {
  const [items, setItems] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const editor = useRef(null);
  const pending = useRef(false);

  async function load() {
    setLoadError(null);
    try { setItems((await call("hikari-info")).items); }
    catch (err) { setLoadError(err); }
  }
  useEffect(() => { load(); }, []);
  function change(key, value) { setForm(current => ({ ...current, [key]: value })); }
  function edit(item) {
    setForm({ ...empty(), ...item });
    setError(""); setNotice("");
    editor.current?.scrollIntoView({ behavior: "auto", block: "start" });
    editor.current?.querySelector("input")?.focus({ preventScroll: true });
  }
  async function save(event) {
    event.preventDefault();
    if (pending.current) return;
    setError(""); setNotice("");
    if (!form.title.trim() || !form.body.trim()) {
      setError("Judul dan isi wajib diisi."); return;
    }
    for (const key of ["image", "url"]) {
      if (!form[key].trim()) continue;
      try {
        const url = new URL(form[key].trim());
        if (url.protocol !== "https:" || url.username || url.password) throw Error();
      } catch { setError("URL gambar dan tautan harus menggunakan HTTPS tanpa kredensial."); return; }
    }
    pending.current = true; setBusy(true);
    try {
      const body = { ...form, title: form.title.trim(), body: form.body.trim(), image: form.image.trim(), url: form.url.trim() };
      await call("hikari-info", { method: form.id ? "PUT" : "POST", body });
      setNotice(form.published ? "Info diterbitkan ke Hikari." : "Draf disimpan. Info belum tampil di Hikari.");
      setForm(empty());
      await load();
    } catch (err) { setError(err.message); }
    finally { pending.current = false; setBusy(false); }
  }
  async function remove(item) {
    if (pending.current || !confirm(`Hapus info “${item.title}”? Tindakan ini tidak dapat dibatalkan.`)) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await call("hikari-info", { method: "DELETE", body: { id: item.id } });
      if (form.id === item.id) setForm(empty());
      setNotice("Info dihapus.");
      await load();
    } catch (err) { setError(err.message); }
    finally { pending.current = false; setBusy(false); }
  }
  return <>
    <div ref={editor}>
      <Panel title={form.id ? "Edit info Hikari" : "Tambah info Hikari"} icon="news">
        <form className="dash-form" onSubmit={save}>
          <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "grid", gap: 16 }}>
            <label><span>Judul</span><input required maxLength={160} value={form.title} onChange={e => change("title", e.target.value)} /></label>
            <label><span id="hikari-body-label">Isi pengumuman</span><textarea aria-labelledby="hikari-body-label" required maxLength={10000} rows={7} value={form.body} onChange={e => change("body", e.target.value)} style={{ width: "100%", padding: 14, border: "1px solid var(--line-2)", borderRadius: 12, background: "var(--panel-2)", color: "inherit", font: "inherit", resize: "vertical" }} /></label>
            <label><span>URL gambar (opsional)</span><input type="url" maxLength={2000} placeholder="https://…" value={form.image} onChange={e => change("image", e.target.value)} /></label>
            <label><span>Tautan tujuan (opsional)</span><input type="url" maxLength={2000} placeholder="https://…" value={form.url} onChange={e => change("url", e.target.value)} /></label>
            <label style={{ display: "flex", alignItems: "center" }}><input type="checkbox" checked={form.published} onChange={e => change("published", e.target.checked)} style={{ width: 18, height: 18 }} /><span>Terbitkan di Hikari</span></label>
            <label style={{ display: "flex", alignItems: "center" }}><input type="checkbox" checked={form.pinned} onChange={e => change("pinned", e.target.checked)} style={{ width: 18, height: 18 }} /><span>Pin di urutan teratas</span></label>
            <p className="dash-note">Tanpa centang Terbitkan, info disimpan sebagai draf dan hanya terlihat oleh admin. Pin berlaku saat info diterbitkan.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button className="dash-btn" type="submit">{busy ? "Menyimpan…" : form.published ? "Simpan & terbitkan" : "Simpan draf"}</button>
              <button className="dash-btn ghost" type="button" onClick={() => { setForm(empty()); setError(""); setNotice(""); }}>{form.id ? "Batal edit" : "Kosongkan form"}</button>
            </div>
          </fieldset>
          {error && <p role="alert" className="auth-error">{error}</p>}
          {notice && <p role="status">{notice}</p>}
        </form>
      </Panel>
    </div>
    <Panel title="Daftar info Hikari" icon="list" action={<button type="button" className="dash-btn ghost" disabled={busy} onClick={load}>Muat ulang</button>}>
      {loadError && <Failure error={loadError} onRetry={load} />}
      {items === null && !loadError && <Loading rows={3} />}
      {items?.length === 0 && <p className="dash-note">Belum ada info. Tulis pengumuman pertama melalui form di atas.</p>}
      {items?.map(item => <article key={item.id} style={{ padding: "20px 0", borderBottom: "1px solid var(--line)", overflowWrap: "anywhere" }}>
        <h3>{item.title}</h3>
        <p className="dash-note">{item.published ? "Terbit" : "Draf"}{item.pinned ? " · Dipin" : ""} · {new Date(item.updated_at || item.published_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</p>
        <p style={{ whiteSpace: "pre-wrap" }}>{item.body}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button className="dash-btn" disabled={busy} onClick={() => edit(item)}>Edit</button>
          <button className="dash-btn danger-text" disabled={busy} onClick={() => remove(item)}>Hapus</button>
        </div>
      </article>)}
    </Panel>
  </>;
}

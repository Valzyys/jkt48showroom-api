import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMotionEnabled } from "./motion.js";
import { gsap, Icon, Link, navigate, useLiquid } from "./shared.jsx";
import { AsciiScene } from "./ascii-scene.jsx";
import { Mark, PixelIcon } from "./icons.jsx";
import { api, setAccount, useAccount } from "./session.js";

// Sign in / create account. Left: an ink stage with the ASCII "48" and a
// terminal that types the first request. Right: the form, with a liquid tab
// between the two modes and an ASCII strength meter for new passwords.
const TERMINAL = [
  ["$", 'curl -H "X-API-Key: jkc_••••••" \\'],
  [" ", "  https://api.jkt48connect.app/api/news"],
  ["→", "200 OK · X-RateLimit-Remaining: 999"],
];

function strength(password) {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  return Math.min(4, score);
}
const STRENGTH = ["Terlalu pendek", "Lemah", "Cukup", "Kuat", "Sangat kuat"];

function Field({ label, icon, children, hint, className = "" }) {
  return (
    <label className={"auth-field " + className}>
      <span className="auth-label">
        <PixelIcon name={icon} size={11} /> {label}
      </span>
      {children}
      {hint}
    </label>
  );
}

export function AuthPage({ mode }) {
  const register = mode === "register",
    account = useAccount(),
    motionEnabled = useMotionEnabled(),
    root = useRef(),
    tabs = useRef(),
    form = useRef(),
    marker = useLiquid(tabs, "a.on", [mode]),
    [values, setValues] = useState({ name: "", email: "", password: "" }),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  // ?next=/control/admin returns an admin to the control panel after sign-in.
  const next =
    new URLSearchParams(location.search).get("next") === "/control/admin"
      ? "/control/admin"
      : null;
  const done = (path) => (next ? location.assign(next) : navigate(path));
  useEffect(() => {
    if (account) done("/dashboard");
  }, [account]);
  useEffect(() => setError(""), [mode]);
  useEffect(() => {
    document.title =
      (register ? "Buat akun" : "Masuk") + " · JKT48Connect Developers";
  }, [register]);
  // Entrance: the stage wipes open, then the form rises field by field.
  useEffect(() => {
    if (!motionEnabled) return;
    const ctx = gsap.context(() => {
      gsap
        .timeline({ defaults: { ease: "expo.out" } })
        .from(".auth-stage", {
          clipPath: "inset(0 100% 0 0 round 28px)",
          duration: 1.2,
          clearProps: "clipPath",
        })
        .from(
          ".auth-card > *",
          {
            y: 22,
            autoAlpha: 0,
            duration: 0.8,
            stagger: 0.06,
            clearProps: "transform,opacity,visibility",
          },
          0.25,
        )
        .from(
          ".auth-perks li",
          {
            x: -16,
            autoAlpha: 0,
            duration: 0.7,
            stagger: 0.08,
            clearProps: "transform,opacity,visibility",
          },
          0.6,
        );
      // Type the terminal one line at a time.
      gsap.utils.toArray(".auth-term code").forEach((line, i) => {
        const text = line.textContent,
          typed = { n: 0 };
        line.textContent = "";
        gsap.to(typed, {
          n: text.length,
          duration: text.length * 0.025,
          delay: 0.9 + i * 0.9,
          ease: "none",
          onUpdate: () =>
            (line.textContent = text.slice(0, Math.round(typed.n))),
          onComplete: () => (line.textContent = text),
        });
      });
    }, root);
    return () => ctx.revert();
  }, [motionEnabled]);
  // Switching mode morphs the form height instead of jumping.
  const lastHeight = useRef(0);
  useLayoutEffect(() => {
    const el = form.current;
    if (!el) return;
    const to = el.offsetHeight;
    if (motionEnabled && lastHeight.current && lastHeight.current !== to)
      gsap.fromTo(
        el,
        { height: lastHeight.current },
        { height: to, duration: 0.5, ease: "expo.out", clearProps: "height" },
      );
    lastHeight.current = to;
    if (motionEnabled)
      gsap.from(el.querySelectorAll(".auth-field.only"), {
        autoAlpha: 0,
        y: -8,
        duration: 0.45,
        ease: "expo.out",
        clearProps: "transform,opacity,visibility",
      });
  }, [mode]);

  const score = strength(values.password);
  const set = (key) => (e) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await api(register ? "/register" : "/login", {
        method: "POST",
        body: register
          ? values
          : { email: values.email, password: values.password },
      });
      setAccount(data.account, data.csrf);
      done(register ? "/dashboard/keys?welcome=1" : "/dashboard");
    } catch (err) {
      setError(err.message);
      if (motionEnabled)
        gsap.fromTo(
          form.current,
          { x: -8 },
          { x: 0, duration: 0.6, ease: "elastic.out(1.2, 0.3)" },
        );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth" ref={root}>
      <section className="auth-stage" aria-hidden="true">
        <div className="auth-stage-top">
          <span className="brand-tile">
            <Mark size={18} />
          </span>
          <span className="auth-stage-tag">DEVELOPER ACCESS</span>
        </div>
        <AsciiScene
          shape="48"
          size={12}
          speed={0.4}
          sway={0.3}
          zoom={1.05}
          className="auth-ascii"
        />
        <div className="auth-term">
          {TERMINAL.map(([sign, text], i) => (
            <p key={i} className={sign === "→" ? "ok" : ""}>
              <span>{sign}</span>
              <code>{text}</code>
            </p>
          ))}
        </div>
        <ul className="auth-perks">
          <li>
            <PixelIcon name="key" size={12} /> API key gratis, langsung aktif
          </li>
          <li>
            <PixelIcon name="pulse" size={12} /> Analytics & log setiap request
          </li>
          <li>
            <PixelIcon name="card" size={12} /> Upgrade paket & isi ulang via
            QRIS
          </li>
        </ul>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <nav className="auth-tabs" ref={tabs} aria-label="Pilih mode">
            <span className="auth-tabs-pill" ref={marker} aria-hidden="true" />
            <Link
              href="/login"
              className={register ? "" : "on"}
              aria-current={register ? undefined : "page"}
            >
              Masuk
            </Link>
            <Link
              href="/register"
              className={register ? "on" : ""}
              aria-current={register ? "page" : undefined}
            >
              Daftar
            </Link>
          </nav>
          <h1 className="auth-title">
            {register ? (
              <>
                Buat akun,
                <br />
                <em>ambil key-mu.</em>
              </>
            ) : (
              <>
                Selamat datang
                <br />
                <em>kembali.</em>
              </>
            )}
          </h1>
          <p className="auth-lead">
            {register
              ? "Gratis 1.000 request tiap bulan. Tanpa kartu kredit."
              : "Masuk untuk mengelola API key, kuota, dan tagihan."}
          </p>
          <form ref={form} className="auth-form" onSubmit={submit} noValidate>
            {register && (
              <Field label="Nama" icon="user" className="only">
                <input
                  className="auth-input"
                  value={values.name}
                  onChange={set("name")}
                  autoComplete="name"
                  maxLength={60}
                  required
                  placeholder="Nama atau nama proyek"
                />
              </Field>
            )}
            <Field label="Email" icon="news">
              <input
                className="auth-input"
                type="email"
                value={values.email}
                onChange={set("email")}
                autoComplete="email"
                required
                placeholder="kamu@contoh.com"
              />
            </Field>
            <Field
              label="Password"
              icon="shield"
              hint={
                register && (
                  <span className="auth-meter" aria-live="polite">
                    <span className={"bars s" + score} aria-hidden="true">
                      {"████".split("").map((c, i) => (
                        <i key={i} className={i < score ? "on" : ""} />
                      ))}
                    </span>
                    <small>
                      {values.password
                        ? STRENGTH[score]
                        : "Minimal 8 karakter, huruf dan angka"}
                    </small>
                  </span>
                )
              }
            >
              <span className="auth-pass">
                <input
                  className="auth-input"
                  type={show ? "text" : "password"}
                  value={values.password}
                  onChange={set("password")}
                  autoComplete={register ? "new-password" : "current-password"}
                  minLength={8}
                  required
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  aria-label={
                    show ? "Sembunyikan password" : "Tampilkan password"
                  }
                  aria-pressed={show}
                >
                  {show ? "Sembunyikan" : "Lihat"}
                </button>
              </span>
            </Field>
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            <button className="auth-submit" type="submit" disabled={busy}>
              <span>
                {busy
                  ? "Memproses…"
                  : register
                    ? "Buat akun gratis"
                    : "Masuk ke dashboard"}
              </span>
              <span className="cta-arrow">
                <Icon size={14} />
              </span>
            </button>
          </form>
          <p className="auth-switch">
            {register ? "Sudah punya akun? " : "Belum punya akun? "}
            <Link href={register ? "/login" : "/register"}>
              {register ? "Masuk" : "Daftar gratis"}
            </Link>
          </p>
          <p className="auth-fine">
            Dengan mendaftar kamu setuju memakai API secara wajar. JKT48Connect
            adalah proyek fans independen.
          </p>
        </div>
      </section>
    </div>
  );
}

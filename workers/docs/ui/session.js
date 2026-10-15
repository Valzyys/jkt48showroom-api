import { useEffect, useState, useSyncExternalStore } from "react";

// Who is signed in to the developer dashboard. One shared store so the header,
// the auth pages and the dashboard agree without refetching.
let account,
  csrf = null,
  loaded = false,
  pending;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export async function api(path, { method = "GET", body } = {}) {
  const write = method !== "GET";
  const response = await fetch("/dashboard/api" + path, {
    method,
    credentials: "same-origin",
    // Writes carry the session's CSRF token and a header other sites can't
    // send without a CORS preflight we never grant.
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
  if (!response.ok) {
    if (response.status === 401 && path !== "/login") setAccount(null);
    throw Object.assign(new Error(data.message || "Permintaan gagal"), {
      status: response.status,
    });
  }
  return data;
}

export function setAccount(next, token) {
  account = next;
  if (token !== undefined) csrf = token;
  if (!next) csrf = null;
  loaded = true;
  emit();
}
export function loadAccount(force = false) {
  if ((loaded || pending) && !force) return pending;
  pending = api("/session")
    .then((data) => setAccount(data.account, data.csrf))
    .catch(() => setAccount(null))
    .finally(() => (pending = null));
  return pending;
}
const subscribe = (fn) => {
  listeners.add(fn);
  loadAccount();
  return () => listeners.delete(fn);
};
// undefined while loading, null when signed out.
export function useAccount() {
  return useSyncExternalStore(
    subscribe,
    () => (loaded ? account : undefined),
    () => undefined,
  );
}

// Fetch a dashboard endpoint and keep it fresh across navigation.
export function useApi(path, deps = []) {
  const [state, setState] = useState({
    data: null,
    error: null,
    loading: true,
  });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    api(path)
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

const number = new Intl.NumberFormat("id-ID");
export const fmt = (value) => number.format(Math.round(value || 0));
export const rupiah = (value) => "Rp" + number.format(value || 0);
export const compact = (value) =>
  value >= 1e6
    ? (value / 1e6).toFixed(value >= 1e7 ? 0 : 1).replace(".", ",") + " jt"
    : value >= 1e4
      ? Math.round(value / 1e3) + " rb"
      : fmt(value);
export function ago(ms) {
  if (!ms) return "belum pernah";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "baru saja";
  if (s < 3600) return Math.floor(s / 60) + " menit lalu";
  if (s < 86400) return Math.floor(s / 3600) + " jam lalu";
  if (s < 86400 * 30) return Math.floor(s / 86400) + " hari lalu";
  return date(ms);
}
export const date = (ms) =>
  new Date(ms).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
export const time = (ms) =>
  new Date(ms).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Jakarta",
  });

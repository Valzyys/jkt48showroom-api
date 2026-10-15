// What the request log keeps about each call: where it came from and what it
// carried. Secrets never reach the database: cookie values, credentials and
// API keys are masked before storage, so the owner sees names, sizes and a
// recognisable preview, never a value someone could replay.
const SECRET_HEADER =
  /^(cookie|set-cookie|authorization|proxy-authorization|x-api-key|x-refresh-token|x-access-token|x-sr-token|x-signature|x-nonce|cf-access-[\w-]+)$/i;
const SECRET_QUERY =
  /^(api_?key|key|token|access_token|password|passwd|secret|signature|sig|auth|session)$/i;
// Network plumbing the Worker already reports in structured fields.
const PLUMBING =
  /^(cf-connecting-ip|cf-connecting-ipv6|cf-ipcountry|cf-ray|cf-visitor|cf-worker|cdn-loop|x-forwarded-for|x-forwarded-proto|x-real-ip|true-client-ip)$/i;

export function mask(value) {
  const text = String(value ?? "");
  if (/^jkc_[a-f0-9]{40}$/.test(text))
    return text.slice(0, 10) + "…" + text.slice(-4);
  return text ? `•••• (${text.length} karakter)` : "";
}

export const keySource = (request, url) =>
  request.headers.get("X-API-Key")
    ? "header"
    : url.searchParams.get("api_key") || url.searchParams.get("apikey")
      ? "query"
      : "";

export function captureRequest(request, url) {
  const cf = request.cf || {};
  const headers = [];
  for (const [name, value] of request.headers) {
    if (PLUMBING.test(name) || headers.length >= 40) continue;
    headers.push({
      name,
      value: SECRET_HEADER.test(name)
        ? mask(value)
        : String(value).slice(0, 300),
      masked: SECRET_HEADER.test(name) || undefined,
    });
  }
  const cookies = (request.headers.get("Cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((part) => {
      const at = part.indexOf("=");
      const name = (at < 0 ? part : part.slice(0, at)).slice(0, 80);
      return { name, size: at < 0 ? 0 : part.length - at - 1 };
    });
  const query = [];
  for (const [name, value] of url.searchParams) {
    if (query.length >= 30) break;
    query.push({
      name: name.slice(0, 80),
      value: SECRET_QUERY.test(name) ? mask(value) : value.slice(0, 300),
      masked: SECRET_QUERY.test(name) || undefined,
    });
  }
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "";
  return {
    ip: ip.slice(0, 64),
    country: String(
      cf.country || request.headers.get("CF-IPCountry") || "",
    ).slice(0, 8),
    city: String(cf.city || "").slice(0, 80),
    region: String(cf.region || "").slice(0, 80),
    colo: String(cf.colo || "").slice(0, 8),
    asOrg: String(cf.asOrganization || "").slice(0, 120),
    userAgent: String(request.headers.get("User-Agent") || "").slice(0, 300),
    referer: String(request.headers.get("Referer") || "").slice(0, 300),
    origin: String(request.headers.get("Origin") || "").slice(0, 200),
    keySource: keySource(request, url),
    details: {
      url:
        url.pathname +
        (query.length ? "?" + query.map((q) => q.name).join("&") : ""),
      query,
      headers,
      cookies,
      network: {
        asn: cf.asn || null,
        timezone: cf.timezone || "",
        postalCode: cf.postalCode || "",
        latitude: cf.latitude || "",
        longitude: cf.longitude || "",
        httpProtocol: cf.httpProtocol || "",
        tlsVersion: cf.tlsVersion || "",
        tlsCipher: cf.tlsCipher || "",
        clientTcpRtt: cf.clientTcpRtt ?? null,
      },
    },
  };
}

// Keep the stored JSON valid and bounded: trim header values, then drop them.
export function serializeDetails(details, max = 12000) {
  let text = JSON.stringify(details);
  if (text.length <= max) return text;
  const trimmed = {
    ...details,
    headers: details.headers.map((h) => ({
      ...h,
      value: h.value.slice(0, 80),
    })),
  };
  text = JSON.stringify(trimmed);
  return text.length <= max
    ? text
    : JSON.stringify({ ...trimmed, headers: [], query: [], truncated: true });
}

// The developer's key travels in the query sometimes; drop it before the
// request reaches routes and caches so it is never stored with a response.
export function withoutKeyParams(request) {
  const url = new URL(request.url);
  if (!url.searchParams.has("api_key") && !url.searchParams.has("apikey"))
    return request;
  url.searchParams.delete("api_key");
  url.searchParams.delete("apikey");
  return new Request(url, request);
}

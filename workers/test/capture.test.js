import { test } from "node:test";
import assert from "node:assert/strict";
import {
  captureRequest,
  keySource,
  mask,
  serializeDetails,
  withoutKeyParams,
} from "../src/accounts/capture.js";

const key = "jkc_" + "a".repeat(36) + "b9c8";

test("request capture keeps origin details and masks every secret", () => {
  const url = new URL(
    `https://api.test/api/news?page=2&apikey=${key}&token=hunter2`,
  );
  const request = new Request(url, {
    headers: {
      "CF-Connecting-IP": "203.0.113.9",
      "CF-IPCountry": "ID",
      Authorization: "Bearer very-secret",
      Cookie: "sid=s3cr3tvalue; theme=dark",
      "User-Agent": "curl/8.5",
      Referer: "https://fanbase.test/",
      "X-Forwarded-For": "203.0.113.9",
    },
  });
  const seen = captureRequest(request, url);
  assert.equal(seen.ip, "203.0.113.9");
  assert.equal(seen.country, "ID");
  assert.equal(seen.userAgent, "curl/8.5");
  assert.equal(seen.keySource, "query");
  assert.deepEqual(seen.details.cookies, [
    { name: "sid", size: 11 },
    { name: "theme", size: 4 },
  ]);
  const query = Object.fromEntries(
    seen.details.query.map((q) => [q.name, q.value]),
  );
  assert.equal(query.page, "2");
  assert.equal(query.apikey, mask(key));
  assert.equal(query.token, "•••• (7 karakter)");
  const auth = seen.details.headers.find((h) => h.name === "authorization");
  assert.equal(auth.value, "•••• (18 karakter)");
  // Plumbing headers already live in structured fields.
  assert.ok(!seen.details.headers.some((h) => h.name === "x-forwarded-for"));
  const stored = serializeDetails(seen.details);
  for (const secret of [key, "hunter2", "very-secret", "s3cr3tvalue"])
    assert.ok(!stored.includes(secret), secret + " leaked");
});

test("keys are previewed, sources detected and stripped from the URL", () => {
  assert.equal(mask(key), key.slice(0, 10) + "…b9c8");
  assert.equal(mask(""), "");
  const header = new Request("https://api.test/api/x", {
    headers: { "X-API-Key": key },
  });
  assert.equal(keySource(header, new URL(header.url)), "header");
  const plain = new Request("https://api.test/api/x?q=1");
  assert.equal(keySource(plain, new URL(plain.url)), "");
  assert.equal(withoutKeyParams(plain), plain);
  const stripped = withoutKeyParams(
    new Request(`https://api.test/api/x?q=1&api_key=${key}&apikey=${key}`),
  );
  assert.equal(stripped.url, "https://api.test/api/x?q=1");
});

test("oversized details stay valid JSON within the limit", () => {
  const details = {
    url: "/api/x",
    query: [{ name: "q", value: "1" }],
    headers: Array.from({ length: 40 }, (_, i) => ({
      name: "x-h" + i,
      value: "v".repeat(300),
    })),
    cookies: [],
  };
  const small = JSON.parse(serializeDetails(details, 6000));
  assert.ok(small.headers.every((h) => h.value.length <= 80));
  const tiny = JSON.parse(serializeDetails(details, 500));
  assert.equal(tiny.truncated, true);
  assert.deepEqual(tiny.headers, []);
});

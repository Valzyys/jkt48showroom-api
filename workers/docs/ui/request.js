export const routeKey = (route) => route.method + " " + route.path;
export function routeHref(route) {
  return "/docs/reference?route=" + encodeURIComponent(routeKey(route));
}
export function initialParams(route) {
  const values = { ...route.query };
  const template = route.path.split("/"),
    example = (route.examplePath || route.path).split("/");
  template.forEach((part, i) => {
    if (part.startsWith(":"))
      values[part.slice(1)] =
        example[i] && !example[i].startsWith(":")
          ? example[i]
          : part == ":data_id"
            ? "DATA_ID"
            : part == ":path"
              ? "media/jkt48-member/anindya_ramadhani.jpg"
              : "ID";
  });
  return values;
}
export function requestUrl(
  route,
  values = {},
  base = "https://api.jkt48connect.app",
) {
  let path = route.path;
  for (const key of Object.keys(values))
    path = path.replace(":" + key, encodeURIComponent(values[key]));
  const url = new URL(path, base);
  for (const key of Object.keys(route.query || {}))
    if (values[key] !== undefined && values[key] !== "")
      url.searchParams.set(key, values[key]);
  return url;
}
export function exampleHeaders(route) {
  const headers = { ...route.headers };
  if (/API key/.test(route.auth)) headers["x-api-key"] = "SERVER_API_KEY";
  if (route.contentType && route.contentType !== "multipart/form-data")
    headers["Content-Type"] = route.contentType;
  return headers;
}
const quote = (value) => "'" + String(value).replaceAll("'", "'\\''") + "'";
const pythonLiteral = (value) =>
  value === null
    ? "None"
    : typeof value === "boolean"
      ? value
        ? "True"
        : "False"
      : Array.isArray(value)
        ? "[" + value.map(pythonLiteral).join(", ") + "]"
        : typeof value === "object"
          ? "{" +
            Object.entries(value)
              .map(([k, v]) => JSON.stringify(k) + ": " + pythonLiteral(v))
              .join(", ") +
            "}"
          : JSON.stringify(value);
export function requestCode(route, values, language = "curl") {
  const url = requestUrl(route, values).href,
    headers = exampleHeaders(route),
    body = route.body;
  if (language === "curl") {
    let code =
      "curl " +
      (route.method === "HEAD"
        ? "-I "
        : route.method !== "GET"
          ? "-X " + route.method + " "
          : "") +
      quote(url);
    for (const [key, value] of Object.entries(headers))
      code += " \\\n  -H " + quote(key + ": " + value);
    if (route.binaryFile)
      code += " \\\n  --data-binary " + quote("@" + route.binaryFile);
    if (body && route.contentType === "application/json")
      code += " \\\n  --data " + quote(JSON.stringify(body));
    else if (body)
      for (const [key, value] of Object.entries(body))
        for (const v of Array.isArray(value) ? value : [value])
          code +=
            " \\\n  " +
            (route.contentType === "multipart/form-data"
              ? "-F "
              : "--data-urlencode ") +
            quote(key + "=" + v);
    return code;
  }
  if (language === "python")
    return (
      "import requests\n\nresponse = requests.request(\n    " +
      JSON.stringify(route.method) +
      ",\n    " +
      JSON.stringify(url) +
      ",\n    headers=" +
      pythonLiteral(headers) +
      "," +
      (route.binaryFile
        ? "\n    data=open(" +
          JSON.stringify(route.binaryFile) +
          ', \"rb\").read(),'
        : "") +
      (body
        ? "\n    " +
          (route.contentType === "application/json" ? "json" : "data") +
          "=" +
          pythonLiteral(body) +
          ","
        : "") +
      "\n    timeout=30,\n)\nresponse.raise_for_status()\nprint(response.text)"
    );
  let setup = route.binaryFile
      ? "// Pilih " + route.binaryFile + " melalui input file.\n"
      : "",
    bodyExpression = route.binaryFile ? "fileInput.files[0]" : "";
  if (body && route.contentType === "application/json")
    bodyExpression = "JSON.stringify(" + JSON.stringify(body, null, 2) + ")";
  else if (body) {
    setup =
      "const body = new " +
      (route.contentType === "multipart/form-data"
        ? "FormData"
        : "URLSearchParams") +
      "();\n";
    for (const [key, value] of Object.entries(body))
      for (const v of Array.isArray(value) ? value : [value])
        setup +=
          "body.append(" +
          JSON.stringify(key) +
          ", " +
          (String(v).startsWith("@")
            ? "fileInput.files[0]"
            : JSON.stringify(v)) +
          ");\n";
    bodyExpression = "body";
  }
  return (
    setup +
    "const response = await fetch(" +
    JSON.stringify(url) +
    ", {\n  method: " +
    JSON.stringify(route.method) +
    ",\n  headers: " +
    JSON.stringify(headers, null, 2) +
    (bodyExpression ? ",\n  body: " + bodyExpression : "") +
    "\n});\nif (!response.ok) throw new Error(`HTTP ${response.status}`);\nconst data = await response.text();\nconsole.log(data);"
  );
}
export function canTry(route) {
  return (
    route.tryEnabled === true &&
    route.method === "GET" &&
    route.auth === "Publik" &&
    !/^\/(?:control|internal|media|replay|ws)(?:\/|$)/.test(route.path) &&
    !/(?:auth|admin|turn|showroom\/|\/stream)/.test(route.path)
  );
}
export function shortResponse(value) {
  if (Array.isArray(value)) return value.slice(0, 2).map(shortResponse);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, shortResponse(v)]),
    );
  return typeof value === "string" && value.length > 1500
    ? value.slice(0, 1500) + "…"
    : value;
}

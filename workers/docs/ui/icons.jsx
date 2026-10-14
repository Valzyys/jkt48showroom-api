import React from "react";

// Pixel icons: 9 x 9 bitmaps drawn as soft dots, the same dot-matrix language
// as the Doto display face and the ASCII figures.
const PIXELS = {
  home: [
    "....#....",
    "...###...",
    "..#####..",
    ".#######.",
    "#########",
    ".#.....#.",
    ".#.###.#.",
    ".#.#.#.#.",
    ".###.###.",
  ],
  code: [
    ".........",
    ".##...##.",
    ".#.....#.",
    ".#.....#.",
    "#.......#",
    ".#.....#.",
    ".#.....#.",
    ".##...##.",
    ".........",
  ],
  markdown: [
    ".........",
    ".........",
    "#...#..#.",
    "##.##..#.",
    "#.#.#..#.",
    "#...#.###",
    "#...#..#.",
    ".........",
    ".........",
  ],
  info: [
    "..#####..",
    ".#.....#.",
    "#...#...#",
    "#.......#",
    "#...#...#",
    "#...#...#",
    "#...#...#",
    ".#.....#.",
    "..#####..",
  ],
  play: [
    ".........",
    ".##......",
    ".####....",
    ".######..",
    ".#######.",
    ".######..",
    ".####....",
    ".##......",
    ".........",
  ],
  key: [
    ".........",
    ".###.....",
    "#...#....",
    "#...#####",
    "#...#.#.#",
    ".###..#.#",
    ".........",
    ".........",
    ".........",
  ],
  news: [
    "#######..",
    "#.....###",
    "#.###.#.#",
    "#.....#.#",
    "#.###.#.#",
    "#.....#.#",
    "#.###.#.#",
    "#.....#.#",
    ".########",
  ],
  calendar: [
    ".#...#...",
    "#########",
    "#.......#",
    "#########",
    "#.#.#.#.#",
    "#.......#",
    "#.#.#.#.#",
    "#.......#",
    "#########",
  ],
  live: [
    ".........",
    ".#.....#.",
    "#..#.#..#",
    "#.#.#.#.#",
    "#..#.#..#",
    ".#.....#.",
    "....#....",
    "....#....",
    "...###...",
  ],
  gift: [
    ".##...##.",
    "#..#.#..#",
    "#########",
    "#...#...#",
    "#########",
    ".#..#..#.",
    ".#..#..#.",
    ".#..#..#.",
    ".#######.",
  ],
  image: [
    ".........",
    "#########",
    "#.......#",
    "#.##....#",
    "#.##....#",
    "#....#..#",
    "#...###.#",
    "#..#####.",
    "#########",
  ],
  replay: [
    ".#######.",
    "#.......#",
    "#..#....#",
    "#..##...#",
    "#..###..#",
    "#..##...#",
    "#..#....#",
    "#.......#",
    ".#######.",
  ],
  camera: [
    "...###...",
    ".#######.",
    "#.......#",
    "#..###..#",
    "#.#...#.#",
    "#.#...#.#",
    "#..###..#",
    "#.......#",
    ".#######.",
  ],
  clock: [
    "..#####..",
    ".#.....#.",
    "#...#...#",
    "#...#...#",
    "#...###.#",
    "#.......#",
    "#.......#",
    ".#.....#.",
    "..#####..",
  ],
  search: [
    ".####....",
    "#....#...",
    "#....#...",
    "#....#...",
    "#....#...",
    ".####....",
    ".....#...",
    "......#..",
    ".......#.",
  ],
  bars: [
    ".........",
    "......##.",
    "......##.",
    "...##.##.",
    "...##.##.",
    "##.##.##.",
    "##.##.##.",
    "##.##.##.",
    ".........",
  ],
  book: [
    ".........",
    "###...###",
    "#..#.#..#",
    "#..#.#..#",
    "#..#.#..#",
    "#..#.#..#",
    "####.####",
    "....#....",
    ".........",
  ],
};
const GUIDE_ICONS = {
  "tentang-panduan": "info",
  "mulai-menggunakan": "play",
  "autentikasi-dan-integrasi": "key",
  "news-dan-member": "news",
  "jadwal-dan-theater": "calendar",
  "live-dan-recent": "live",
  "gift-dan-leaderboard": "gift",
  "gambar-leaderboard-recent": "image",
  "memutar-replay": "replay",
  "media-dan-screenshot": "camera",
  "pagination-waktu-dan-error": "clock",
  markdown: "markdown",
};
export const guideIcon = (slug) => GUIDE_ICONS[slug] || "book";

export function PixelIcon({ name, size = 16, className = "" }) {
  const rows = PIXELS[name] || PIXELS.book;
  return (
    <svg
      className={"pixel-icon " + className}
      width={size}
      height={size}
      viewBox="0 0 9 9"
      aria-hidden="true"
    >
      {rows.flatMap((row, y) =>
        [...row].map((v, x) =>
          v === "#" ? (
            <rect
              key={x + "-" + y}
              x={x + 0.08}
              y={y + 0.08}
              width=".84"
              height=".84"
              rx=".26"
              fill="currentColor"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}

export function Mark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 4h10v5H9v5H4zm14 0h10v10h-5V9h-5zM4 18h5v5h5v5H4zm19 0h5v10H18v-5h5z"
      />
      <rect x="13" y="13" width="6" height="6" rx="1.5" fill="var(--accent)" />
    </svg>
  );
}

export function GitHubIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.83 1.24 1.83 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .32.21.7.82.58A12 12 0 0 0 12 .3"
      />
    </svg>
  );
}

// Language marks for code examples. JavaScript follows the official square
// mark; Python uses its two interlocking shapes; shells use a prompt.
const LANGS = {
  javascript: "javascript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  typescript: "typescript",
  ts: "typescript",
  tsx: "typescript",
  python: "python",
  py: "python",
  curl: "shell",
  bash: "shell",
  sh: "shell",
  shell: "shell",
  zsh: "shell",
  console: "shell",
  json: "json",
  response: "json",
  html: "html",
  xml: "html",
  css: "css",
  markdown: "markdown",
  md: "markdown",
  mermaid: "diagram",
  http: "http",
};
export const LANG_NAMES = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  python: "Python",
  shell: "Shell",
  json: "JSON",
  html: "HTML",
  css: "CSS",
  markdown: "Markdown",
  diagram: "Diagram",
  http: "HTTP",
  text: "Text",
};
export function langKind(language = "") {
  return LANGS[String(language).toLowerCase()] || "text";
}
export function LangLogo({ language, size = 16 }) {
  const kind = langKind(language);
  const box = { width: size, height: size, viewBox: "0 0 24 24" };
  if (kind === "javascript")
    return (
      <svg {...box} className="lang-logo" aria-hidden="true">
        <rect width="24" height="24" rx="3" fill="#F7DF1E" />
        <path
          fill="#1b1b1d"
          d="M22.03 18.28c-.17-1.1-.89-2.02-3-2.88-.74-.34-1.55-.58-1.8-1.14-.09-.33-.1-.51-.04-.7.15-.65.91-.84 1.51-.66.39.12.75.42.98.9 1.03-.68 1.03-.68 1.75-1.13-.27-.42-.4-.6-.59-.78-.63-.7-1.47-1.06-2.83-1.03l-.7.09c-.68.16-1.32.52-1.71 1-1.14 1.3-.81 3.55.57 4.47 1.36 1.02 3.36 1.25 3.62 2.21.24 1.17-.87 1.54-1.97 1.41-.81-.18-1.26-.59-1.75-1.34l-1.83 1.05c.21.48.45.69.81 1.11 1.74 1.76 6.09 1.67 6.87-1 .03-.1.24-.71.07-1.65zm-8.98-7.25h-2.25l-.01 5.8c0 1.24.06 2.37-.14 2.72-.33.69-1.18.6-1.57.48-.39-.2-.6-.47-.83-.86-.06-.1-.11-.2-.13-.2l-1.82 1.13c.3.63.75 1.17 1.32 1.52.86.51 2 .67 3.21.4.78-.22 1.46-.69 1.81-1.41.51-.93.4-2.07.4-3.35.01-2.05 0-4.1 0-6.18z"
        />
      </svg>
    );
  if (kind === "typescript")
    return (
      <svg {...box} className="lang-logo" aria-hidden="true">
        <rect width="24" height="24" rx="3" fill="#3178C6" />
        <path
          fill="#fff"
          d="M5.2 12.6h3v8.2h2.1v-8.2h3v-1.8H5.2zm13.3 2.1c-.9-.4-1.6-.6-1.6-1.2 0-.4.4-.7 1-.7.6 0 1.2.3 1.7.8l1.3-1.1c-.6-.8-1.6-1.3-2.9-1.3-1.8 0-3 1-3 2.4 0 1.5 1 2.1 2.4 2.7.9.4 1.5.6 1.5 1.2 0 .5-.5.8-1.2.8-.9 0-1.6-.4-2.1-1.1L14.4 18c.6 1 1.8 1.6 3.2 1.6 1.9 0 3.2-1 3.2-2.5 0-1.4-.9-2-2.3-2.4z"
        />
      </svg>
    );
  if (kind === "python")
    return (
      <svg {...box} className="lang-logo" aria-hidden="true">
        <path
          fill="#3776AB"
          d="M11.9 2C9.3 2 7.6 2.9 7.6 4.6V7h4.5v.8H5.4C3.5 7.8 2 9.4 2 12s1.5 4.2 3.4 4.2h1.7v-2.5c0-1.6 1.4-3 3-3h4.6c1.4 0 2.4-1 2.4-2.4V4.6C17.1 3 15.4 2 11.9 2z"
        />
        <path
          fill="#FFD43B"
          d="M12.1 22c2.6 0 4.3-.9 4.3-2.6V17h-4.5v-.8h6.7c1.9 0 3.4-1.6 3.4-4.2s-1.5-4.2-3.4-4.2h-1.7v2.5c0 1.6-1.4 3-3 3H9.3c-1.4 0-2.4 1-2.4 2.4v3.7c0 1.6 1.7 2.6 5.2 2.6z"
        />
        <circle cx="9.6" cy="4.5" r=".9" fill="#fff" />
        <circle cx="14.4" cy="19.5" r=".9" fill="#fff" />
      </svg>
    );
  if (kind === "shell")
    return (
      <svg {...box} className="lang-logo" aria-hidden="true">
        <rect
          x=".75"
          y="2.75"
          width="22.5"
          height="18.5"
          rx="4"
          fill="#232327"
          stroke="#4a4a52"
          strokeWidth="1.5"
        />
        <path
          d="m6 9 3.5 3L6 15m6 1h6"
          fill="none"
          stroke="#6be3a2"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  if (kind === "json")
    return (
      <svg {...box} className="lang-logo" aria-hidden="true">
        <rect width="24" height="24" rx="5" fill="#2b2412" />
        <path
          d="M9 5.5c-2 0-2.4.9-2.4 2.4v1.7c0 1.2-.6 2.1-1.9 2.4 1.3.3 1.9 1.2 1.9 2.4v1.7c0 1.5.4 2.4 2.4 2.4m6-13c2 0 2.4.9 2.4 2.4v1.7c0 1.2.6 2.1 1.9 2.4-1.3.3-1.9 1.2-1.9 2.4v1.7c0 1.5-.4 2.4-2.4 2.4"
          fill="none"
          stroke="#ffc178"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  if (kind === "html")
    return (
      <svg {...box} className="lang-logo" aria-hidden="true">
        <rect width="24" height="24" rx="5" fill="#E44D26" />
        <path
          d="m9 8-4 4 4 4m6-8 4 4-4 4"
          fill="none"
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  if (kind === "css")
    return (
      <svg {...box} className="lang-logo" aria-hidden="true">
        <rect width="24" height="24" rx="5" fill="#663399" />
        <path
          d="M9 7c-2 0-2.5 1-2.5 2.5v1c0 1-.5 1.5-1.5 1.5 1 0 1.5.5 1.5 1.5v1C6.5 16 7 17 9 17m6-10c2 0 2.5 1 2.5 2.5v1c0 1 .5 1.5 1.5 1.5-1 0-1.5.5-1.5 1.5v1c0 1.5-.5 2.5-2.5 2.5"
          fill="none"
          stroke="#fff"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  if (kind === "markdown")
    return (
      <svg {...box} className="lang-logo" aria-hidden="true">
        <rect
          x=".75"
          y="4.75"
          width="22.5"
          height="14.5"
          rx="3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M5 15V9l2.5 3L10 9v6m6-6v6m-2.5-2.5L16 15l2.5-2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  if (kind === "diagram")
    return (
      <svg {...box} className="lang-logo" aria-hidden="true">
        <rect width="24" height="24" rx="5" fill="#ff3670" />
        <path
          d="M6 7h4v4H6zm8 6h4v4h-4zM8 11v4h6M10 9h4v4"
          fill="none"
          stroke="#fff"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    );
  return (
    <svg {...box} className="lang-logo" aria-hidden="true">
      <path
        d="M6 2.75h8L19.25 8v12A1.25 1.25 0 0 1 18 21.25H6A1.25 1.25 0 0 1 4.75 20V4A1.25 1.25 0 0 1 6 2.75zM14 3v5h5M8 13h8m-8 3.5h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

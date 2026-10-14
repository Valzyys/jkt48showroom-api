import React, { useEffect, useId, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes.code || []),
      ["className", /^language-./, "math-inline", "math-display"],
    ],
    blockquote: [
      ...(defaultSchema.attributes.blockquote || []),
      ["className", "callout"],
    ],
  },
};
export function CopyButton({ text, label = "Salin", className = "" }) {
  const [copied, setCopied] = useState(false),
    timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={"copy-button " + className}
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1800);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Tersalin ✓" : label}
      <span className="sr-only" role="status">
        {copied ? "Kode disalin" : ""}
      </span>
    </button>
  );
}
function Diagram({ source }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, ""),
    [svg, setSvg] = useState(""),
    [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (source.length > 20000) throw Error();
        const [{ default: mermaid }, { default: purify }] = await Promise.all([
          import("mermaid"),
          import("dompurify"),
        ]);
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
          htmlLabels: false,
          flowchart: { htmlLabels: false },
          fontFamily: "Geist, Arial",
          maxTextSize: 20000,
        });
        const result = await mermaid.render("diagram-" + id, source);
        if (!cancelled)
          setSvg(
            purify.sanitize(result.svg, {
              USE_PROFILES: { svg: true, svgFilters: true },
            }),
          );
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, id]);
  return (
    <figure className="diagram">
      <figcaption>
        Diagram <CopyButton text={source} />
      </figcaption>
      {error ? (
        <>
          <p>Diagram belum dapat dirender. Source tetap tersedia di bawah.</p>
          <pre>
            <code>{source}</code>
          </pre>
        </>
      ) : svg ? (
        <div
          className="diagram-svg"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <p role="status">Memuat diagram…</p>
      )}
    </figure>
  );
}
function Pre({ children }) {
  const code = React.Children.toArray(children).find(React.isValidElement),
    className = code?.props?.className || "";
  const text = code ? textOf(code.props.children) : textOf(children);
  if (/language-mermaid/.test(className))
    return <Diagram source={text.trim()} />;
  return (
    <div className="code-block">
      <div className="code-toolbar">
        <span className="code-file-label">
          {className.match(/language-(\w+)/)?.[1] || "text"}
        </span>
        <span className="code-meta">
          {text.trimEnd().split("\n").length} LINES
        </span>
        <CopyButton text={text} />
      </div>
      <div className="code-lines">
        <span className="line-numbers" aria-hidden="true">
          {text
            .trimEnd()
            .split("\n")
            .map((_, i) => (
              <span key={i}>{i + 1}</span>
            ))}
        </span>
        <pre tabIndex={0}>{children}</pre>
      </div>
    </div>
  );
}
function textOf(value) {
  return React.Children.toArray(value)
    .map((v) =>
      typeof v === "string" || typeof v === "number"
        ? v
        : React.isValidElement(v)
          ? textOf(v.props.children)
          : "",
    )
    .join("");
}
function Quote({ children }) {
  const text = textOf(children),
    match = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/.exec(text);
  let stripped = false;
  function strip(value) {
    return React.Children.map(value, (v) => {
      if (typeof v === "string" && !stripped) {
        const next = v.replace(
          /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/,
          "",
        );
        if (next !== v) stripped = true;
        return next;
      }
      return React.isValidElement(v) && v.props.children
        ? React.cloneElement(v, {}, strip(v.props.children))
        : v;
    });
  }
  return (
    <blockquote className={match ? "callout " + match[1].toLowerCase() : ""}>
      {match && <strong className="callout-label">{match[1]}</strong>}
      {match ? strip(children) : children}
    </blockquote>
  );
}
// Sanitized raw HTML identifiers keep their anti-clobber prefix. Repair local links.
function localAnchors() {
  return (tree) => {
    const ids = new Set();
    function walk(node, fn) {
      fn(node);
      for (const child of node.children || []) walk(child, fn);
    }
    walk(tree, (n) => {
      if (n.properties?.id) ids.add(String(n.properties.id));
    });
    walk(tree, (n) => {
      const href = n.properties?.href;
      if (typeof href === "string" && href.startsWith("#")) {
        let target;
        try {
          target = decodeURIComponent(href.slice(1));
        } catch {
          return;
        }
        if (!ids.has(target) && ids.has("user-content-" + target))
          n.properties.href = "#user-content-" + target;
      }
    });
  };
}
export default function MarkdownContent({ source }) {
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, schema],
          rehypeSlug,
          localAnchors,
          [rehypeHighlight, { detect: false, ignoreMissing: true }],
          [rehypeKatex, { trust: false, strict: "warn" }],
        ]}
        components={{
          pre: Pre,
          blockquote: Quote,
          a: ({ node, ...props }) => (
            <a
              {...props}
              rel={
                props.href?.startsWith("http")
                  ? "noopener noreferrer"
                  : undefined
              }
            />
          ),
          img: ({ node, ...props }) => (
            <img {...props} loading="lazy" decoding="async" />
          ),
          table: ({ children }) => (
            <div className="table-scroll" tabIndex={0}>
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {source}
      </Markdown>
    </div>
  );
}

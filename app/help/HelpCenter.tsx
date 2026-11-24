"use client";

import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HELP_ARTICLES, HELP_SECTIONS, SHOTS, SUPPORT_EMAIL, type HelpArticle } from "./content";
import "./help.css";

// ---------- tiny markup renderer (see the header of content.ts) ----------

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

function renderInline(text: string, onNavigate: (id: string) => void): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const [, label, href] = link;
      if (href.startsWith("#")) {
        return (
          <a key={index} href={href} onClick={(event) => { event.preventDefault(); onNavigate(href.slice(1)); }}>
            {label}
          </a>
        );
      }
      return <a key={index} href={href} target="_blank" rel="noopener noreferrer">{label}</a>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function ArticleBody({ body, onNavigate }: { body: string; onNavigate: (id: string) => void }) {
  const lines = body.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  const inline = (text: string) => renderInline(text, onNavigate);
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }

    if (trimmed.startsWith("### ")) {
      const text = trimmed.slice(4);
      blocks.push(<h3 key={i} id={slug(text)}>{inline(text)}</h3>);
      i++; continue;
    }
    if (trimmed.startsWith("## ")) {
      const text = trimmed.slice(3);
      blocks.push(<h2 key={i} id={slug(text)}>{inline(text)}</h2>);
      i++; continue;
    }
    const shot = trimmed.match(/^\[\[shot:([a-z0-9-]+)(?:\|(.*))?\]\]$/);
    if (shot) {
      const [, name, caption] = shot;
      if (SHOTS.includes(name)) {
        const src = `/help/shots/${name}.jpg`;
        blocks.push(
          <figure key={i} className="hc-shot">
            <a href={src} target="_blank" rel="noopener noreferrer" title="Open full size">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={caption || name} loading="lazy" />
            </a>
            {caption && <figcaption>{caption}</figcaption>}
          </figure>
        );
      }
      i++; continue;
    }
    if (trimmed.startsWith(">")) {
      const text = trimmed.replace(/^>\s*/, "");
      const kind = /^warning:/i.test(text) ? "warning" : /^tip:/i.test(text) ? "tip" : "note";
      const label = text.match(/^(tip|note|warning):\s*/i);
      blocks.push(
        <div key={i} className={`hc-callout hc-callout-${kind}`}>
          {label && <strong className="hc-callout-label">{label[1][0].toUpperCase() + label[1].slice(1).toLowerCase()}</strong>}
          <p>{inline(label ? text.slice(label[0].length) : text)}</p>
        </div>
      );
      i++; continue;
    }
    if (trimmed.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
        rows.push(cells);
        i++;
      }
      const [head, ...rest] = rows;
      blocks.push(
        <div key={i} className="hc-table-wrap">
          <table className="hc-table">
            <thead><tr>{head.map((cell, c) => <th key={c}>{inline(cell)}</th>)}</tr></thead>
            <tbody>{rest.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c} data-label={head[c] || undefined}>{inline(cell)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }
    if (/^- /.test(trimmed)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^- /.test(lines[i].trim()) && !/^\s{2,}/.test(lines[i])) {
        items.push(<li key={i}>{inline(lines[i].trim().slice(2))}</li>);
        i++;
      }
      blocks.push(<ul key={`ul${i}`}>{items}</ul>);
      continue;
    }
    if (/^\d+\. /.test(trimmed)) {
      const items: Array<{ text: string; sub: string[] }> = [];
      while (i < lines.length) {
        const current = lines[i];
        if (/^\d+\. /.test(current.trim()) && !/^\s{2,}/.test(current)) {
          items.push({ text: current.trim().replace(/^\d+\. /, ""), sub: [] });
          i++;
        } else if (/^\s{2,}- /.test(current) && items.length) {
          items[items.length - 1].sub.push(current.trim().slice(2));
          i++;
        } else break;
      }
      blocks.push(
        <ol key={`ol${i}`}>
          {items.map((item, n) => (
            <li key={n}>
              {inline(item.text)}
              {item.sub.length > 0 && <ul>{item.sub.map((sub, s) => <li key={s}>{inline(sub)}</li>)}</ul>}
            </li>
          ))}
        </ol>
      );
      continue;
    }
    // Paragraph: run of plain lines.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3} |\||>|- |\d+\. |\[\[shot:)/.test(lines[i].trim())) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push(<p key={`p${i}`}>{inline(para.join(" "))}</p>);
  }
  return <>{blocks}</>;
}

// ---------- search ----------

const plain = (text: string) => text
  .replace(/\[\[shot:[^\]]*\]\]/g, " ")
  .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
  .replace(/[*`#>|]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

type Indexed = HelpArticle & { titleL: string; keywordsL: string; summaryL: string; bodyPlain: string; bodyL: string };

const INDEX: Indexed[] = HELP_ARTICLES.map((article) => {
  const bodyPlain = plain(article.body);
  return {
    ...article,
    titleL: article.title.toLowerCase(),
    keywordsL: (article.keywords ?? "").toLowerCase(),
    summaryL: article.summary.toLowerCase(),
    bodyPlain,
    bodyL: bodyPlain.toLowerCase(),
  };
});

function searchArticles(query: string) {
  const terms = query.toLowerCase().replace(/["']/g, "").split(/\s+/).filter((term) => term.length > 1);
  if (!terms.length) return [];
  const phrase = query.toLowerCase().trim();
  return INDEX.map((article) => {
    let score = 0;
    for (const term of terms) {
      const inTitle = article.titleL.includes(term);
      const inKeywords = article.keywordsL.includes(term);
      const inSummary = article.summaryL.includes(term);
      const bodyHits = article.bodyL.split(term).length - 1;
      if (!inTitle && !inKeywords && !inSummary && !bodyHits) return { article, score: 0 };
      score += (inTitle ? 12 : 0) + (inKeywords ? 6 : 0) + (inSummary ? 4 : 0) + Math.min(bodyHits, 6);
    }
    if (phrase.length > 3 && (article.titleL.includes(phrase) || article.bodyL.includes(phrase))) score += 15;
    return { article, score };
  })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 25)
    .map(({ article }) => {
      // Snippet around the first body hit.
      const first = terms.map((term) => article.bodyL.indexOf(term)).filter((at) => at >= 0).sort((a, b) => a - b)[0];
      const start = Math.max(0, (first ?? 0) - 60);
      const snippet = first === undefined
        ? article.summary
        : `${start > 0 ? "…" : ""}${article.bodyPlain.slice(start, start + 180)}${start + 180 < article.bodyPlain.length ? "…" : ""}`;
      return { article, snippet, terms };
    });
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const lower = terms.map((term) => term.toLowerCase());
  return <>{text.split(pattern).map((part, index) => (lower.includes(part.toLowerCase()) ? <mark key={index}>{part}</mark> : <Fragment key={index}>{part}</Fragment>))}</>;
}

// ---------- page ----------

const POPULAR = ["write-ro", "send-estimate", "close-invoice", "record-payment", "online-payments", "staff-add", "trouble-sign-in", "trouble-read-only"];
const SECTION_BLURB: Record<string, string> = {
  "Getting started": "Sign up, set up your shop and learn your way around.",
  "Repair orders": "Write ROs, add jobs, labor and parts, VIN scan, canned jobs.",
  "Estimates & approval": "Send estimates, customer approval and the multipoint inspection.",
  "Doing the work": "The technician's guide, dispatch and alerts.",
  "Invoices & payments": "Close & invoice, online payments, Zelle and counter payments.",
  Customers: "Your customer list, vehicles and service history.",
  Reports: "Sales & tax, team numbers and My stats.",
  Settings: "Shop details, parts pricing, canned jobs and branding.",
  "Staff & teams": "Logins for techs and advisors, roles, teams and dispatch modes.",
  "Your account & billing": "Trial, subscription, passwords and exporting your data.",
  Troubleshooting: "Every error message and how to fix it.",
  FAQ: "Quick answers to common questions.",
};

export function HelpCenter() {
  const [articleId, setArticleId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  // URL: /help#article-id opens an article; /help?q=words opens a search.
  useEffect(() => {
    const read = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      const [id, anchor] = hash.split("/");
      const exists = INDEX.some((article) => article.id === id);
      setArticleId(exists ? id : null);
      if (exists) {
        setQuery("");
        window.requestAnimationFrame(() => {
          const target = anchor ? document.getElementById(anchor) : null;
          if (target) target.scrollIntoView({ block: "start" });
          else window.scrollTo({ top: 0 });
        });
      }
    };
    const params = new URLSearchParams(window.location.search);
    if (params.get("q")) setQuery(params.get("q") ?? "");
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  // "/" focuses search, like most docs sites.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === "/" && !(target && /INPUT|TEXTAREA|SELECT/.test(target.tagName))) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape" && document.activeElement === searchRef.current) setQuery("");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navigate = useCallback((id: string) => {
    setNavOpen(false);
    setQuery("");
    if (window.location.hash === `#${id}`) {
      window.scrollTo({ top: 0 });
      return;
    }
    window.location.hash = id;
  }, []);

  const goHome = useCallback(() => {
    setNavOpen(false);
    setQuery("");
    history.pushState(null, "", window.location.pathname);
    setArticleId(null);
    window.scrollTo({ top: 0 });
  }, []);

  const results = useMemo(() => searchArticles(query), [query]);
  const article = INDEX.find((entry) => entry.id === articleId) ?? null;
  const ordered = INDEX;
  const position = article ? ordered.findIndex((entry) => entry.id === article.id) : -1;
  const prev = position > 0 ? ordered[position - 1] : null;
  const next = position >= 0 && position < ordered.length - 1 ? ordered[position + 1] : null;

  useEffect(() => {
    document.title = article ? `${article.title} · ROrunner Help` : "Help Center · ROrunner";
  }, [article]);

  const searching = query.trim().length > 1;

  const sidebar = (
    <nav className={`hc-nav${navOpen ? " open" : ""}`} aria-label="Help topics">
      {HELP_SECTIONS.map((section) => (
        <div key={section} className="hc-nav-section">
          <div className="hc-nav-title">{section}</div>
          <ul>
            {INDEX.filter((entry) => entry.section === section).map((entry) => (
              <li key={entry.id}>
                <a href={`#${entry.id}`} className={entry.id === articleId ? "active" : ""} aria-current={entry.id === articleId ? "page" : undefined}
                  onClick={(event) => { event.preventDefault(); navigate(entry.id); }}>
                  {entry.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="hc">
      <header className="hc-top">
        <div className="hc-top-inner">
          <a href="/help" className="hc-brand" onClick={(event) => { event.preventDefault(); goHome(); }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/rorunner-logo.png" alt="ROrunner" className="logo-on-light" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/rorunner-logo-white.png" alt="ROrunner" className="logo-on-dark" />
            <span>Help Center</span>
          </a>
          <div className="hc-search">
            <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18"><path d="M8.5 3a5.5 5.5 0 014.4 8.8l3.6 3.7-1.1 1-3.6-3.6A5.5 5.5 0 118.5 3zm0 1.5a4 4 0 100 8 4 4 0 000-8z" fill="currentColor" /></svg>
            <input
              ref={searchRef}
              type="search"
              placeholder="Search help (try “estimate”, “Zelle”, “read-only”)"
              aria-label="Search help"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd>/</kbd>
          </div>
          <a className="hc-back" href="/">Open ROrunner →</a>
        </div>
      </header>

      <div className="hc-body">
        <aside className="hc-side">
          <button type="button" className="hc-nav-toggle" aria-expanded={navOpen} onClick={() => setNavOpen((open) => !open)}>
            {navOpen ? "Hide topics" : "All topics"} <span aria-hidden="true">{navOpen ? "▴" : "▾"}</span>
          </button>
          {sidebar}
        </aside>

        <main className="hc-main" ref={mainRef}>
          {searching ? (
            <section aria-live="polite">
              <h1 className="hc-h1">Results for “{query.trim()}”</h1>
              {results.length === 0 ? (
                <div className="hc-empty">
                  <p>No articles match that. Try fewer or different words, like the exact message you&apos;re seeing.</p>
                  <p>Still stuck? Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
                </div>
              ) : (
                <ul className="hc-results">
                  {results.map(({ article: hit, snippet, terms }) => (
                    <li key={hit.id}>
                      <a href={`#${hit.id}`} onClick={(event) => { event.preventDefault(); navigate(hit.id); }}>
                        <span className="hc-result-section">{hit.section}</span>
                        <strong><Highlight text={hit.title} terms={terms} /></strong>
                        <span className="hc-result-snippet"><Highlight text={snippet} terms={terms} /></span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : article ? (
            <article className="hc-article">
              <div className="hc-crumbs">
                <a href="/help" onClick={(event) => { event.preventDefault(); goHome(); }}>Help Center</a>
                <span aria-hidden="true">›</span>
                <span>{article.section}</span>
              </div>
              <h1 className="hc-h1">{article.title}</h1>
              <p className="hc-lede">{article.summary}</p>
              <div className="hc-content">
                <ArticleBody body={article.body} onNavigate={navigate} />
              </div>
              <nav className="hc-pager" aria-label="More articles">
                {prev ? (
                  <a href={`#${prev.id}`} onClick={(event) => { event.preventDefault(); navigate(prev.id); }}>
                    <span>← Previous</span><strong>{prev.title}</strong>
                  </a>
                ) : <span />}
                {next ? (
                  <a href={`#${next.id}`} className="next" onClick={(event) => { event.preventDefault(); navigate(next.id); }}>
                    <span>Next →</span><strong>{next.title}</strong>
                  </a>
                ) : <span />}
              </nav>
              <div className="hc-stuck">
                <strong>Still stuck?</strong> Email <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Help: ${article.title}`)}`}>{SUPPORT_EMAIL}</a> with what you were doing and a screenshot. We&apos;ll sort it out.
              </div>
            </article>
          ) : (
            <section>
              <div className="hc-hero">
                <h1>How can we help?</h1>
                <p>Guides for every screen in ROrunner, plus fixes for every error message.</p>
              </div>
              <div className="hc-popular">
                <span>Popular:</span>
                {POPULAR.map((id) => {
                  const entry = INDEX.find((item) => item.id === id);
                  return entry ? (
                    <a key={id} href={`#${id}`} onClick={(event) => { event.preventDefault(); navigate(id); }}>{entry.title}</a>
                  ) : null;
                })}
              </div>
              <div className="hc-grid">
                {HELP_SECTIONS.map((section) => (
                  <div key={section} className="hc-card">
                    <h2>{section}</h2>
                    <p>{SECTION_BLURB[section]}</p>
                    <ul>
                      {INDEX.filter((entry) => entry.section === section).map((entry) => (
                        <li key={entry.id}>
                          <a href={`#${entry.id}`} onClick={(event) => { event.preventDefault(); navigate(entry.id); }}>{entry.title}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <div className="hc-stuck">
                <strong>Can&apos;t find it?</strong> Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. A screenshot of what you&apos;re seeing helps us help you faster.
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

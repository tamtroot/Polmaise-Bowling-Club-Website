import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { formatNewsDate, isoDateValue } from "../tools/news-dates.mjs";
import { cardExcerpt } from "../tools/news-excerpts.mjs";

/**
 * Stage 13 — news archive index.
 *
 * Eleventy's `collections.newsArticle` / `collections.newsHistory` drive the
 * templates; this data file exists for the things a collection cannot provide:
 * the list of years to paginate year archives, and the legacy anchor map that
 * keeps old `news.html#article-…` deep links working.
 *
 * It reads the same source files, so nothing is duplicated by hand.
 */
const projectRoot = process.cwd();
const newsRoot = path.join(projectRoot, "news");

const unquote = (value) => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return trimmed;
};

function parseFrontMatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const entry = line.match(/^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
    if (!entry) continue;
    const [, key, rawValue] = entry;
    if (key === "tags") {
      data.tags = rawValue.split(",").map((value) => value.trim()).filter(Boolean);
      continue;
    }
    const value = unquote(rawValue);
    data[key] = value === "true" ? true : value === "false" ? false : value;
  }
  return data;
}

async function readDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

const record = (file, data) => {
  const isoDate = isoDateValue(data.isoDate || data.date || "");

  return {
    title: data.title ?? "",
    date: isoDate,
    isoDate,
    // Derived so the landing page, the archives and the article page can never
    // disagree about how a date is written (see tools/news-dates.mjs).
    displayDate: formatNewsDate(isoDate) || data.displayDate || "",
    category: data.category || data.archiveCategory || "",
    year: Number(data.year) || null,
    excerpt: data.excerpt ?? "",
    image: data.image ?? "",
    imageAlt: data.imageAlt ?? "",
    imageCaption: data.imageCaption ?? "",
    /**
     * Stage 15: how the archive should present the image. Newspaper cuttings are
     * shown whole on an archival panel; anything else is treated as a
     * photograph in the same frame. Defaults to "photograph".
     */
    imageType: data.imageType === "clipping" ? "clipping" : "photograph",
    /**
     * The excerpt trimmed to complete sentences for an archive card — never cut
     * mid-sentence or mid-word, and never reworded (tools/news-excerpts.mjs).
     */
    cardExcerpt: cardExcerpt(data.excerpt),
    featured: data.featured === true,
    permalink: data.permalink ?? "",
    legacyId: data.legacyId ?? "",
    section: data.newsSection === "history" ? "history" : "current",
    file: path.relative(projectRoot, file).split(path.sep).join("/"),
  };
};

const articleFiles = [];
for (const yearEntry of await readdir(newsRoot, { withFileTypes: true }).catch(() => [])) {
  if (yearEntry.isDirectory() && /^\d{4}$/.test(yearEntry.name)) {
    articleFiles.push(...(await readDirectory(path.join(newsRoot, yearEntry.name))));
  }
}

const articles = [];
for (const file of articleFiles) {
  articles.push(record(file, parseFrontMatter(await readFile(file, "utf8"))));
}
articles.sort((left, right) => (right.isoDate || "").localeCompare(left.isoDate || ""));

const historyFiles = await readDirectory(path.join(newsRoot, "history"));
const history = [];
for (const file of historyFiles) {
  history.push(record(file, parseFrontMatter(await readFile(file, "utf8"))));
}
history.sort(
  (left, right) =>
    (left.year ?? 0) - (right.year ?? 0) ||
    String(left.isoDate ?? "").localeCompare(String(right.isoDate ?? "")),
);

/**
 * Stage 15 — the archive index reads as chapters: one entry per year, with that
 * year's stories beneath it. The grouping is derived from the same records, so
 * the archive can never drift from the articles themselves.
 */
const historyYears = [];
for (const item of history) {
  const year = item.year ?? null;
  const current = historyYears.at(-1);
  if (current && current.year === year) {
    current.items.push(item);
    continue;
  }
  historyYears.push({ year, items: [item] });
}

const years = [...new Set(articles.map((article) => article.year).filter(Boolean))]
  .sort((left, right) => right - left)
  .map((year) => ({
    year,
    articles: articles.filter((article) => article.year === year),
  }));

/**
 * Landing page composition. The featured story is whichever article carries
 * `featured: true` (falling back to the newest story), then the next three
 * headline cards, then every remaining current story in the compact list. All
 * of it comes from the same sorted list, so the page never repeats a story and
 * never needs hand-curating.
 */
const featured = articles.find((article) => article.featured) ?? articles[0] ?? null;
const remaining = featured
  ? articles.filter((article) => article.permalink !== featured.permalink)
  : articles;
const latest = remaining.slice(0, 3);
const more = remaining.slice(3);

/**
 * Category groups. The source pages use several wordings for the same kind of
 * story, so they are mapped onto the small set of groups the landing page
 * offers. Only groups that actually contain stories are published.
 */
const CATEGORY_GROUPS = [
  { name: "Competition", slug: "competition", match: ["Competition", "Competition News", "Competitions"] },
  { name: "Tournament", slug: "tournament", match: ["Tournament", "Tournaments"] },
  { name: "Community", slug: "community", match: ["Community", "Community Engagement"] },
  {
    name: "Club",
    slug: "club",
    match: [
      "Club Event",
      "Club News",
      "Club Achievement",
      "Friendly Fixture",
      "Special Event",
      "Media Coverage",
      "New Archive Added",
    ],
  },
];

const categories = CATEGORY_GROUPS.map((group) => ({
  name: group.name,
  slug: group.slug,
  articles: articles.filter((article) => group.match.includes(article.category)),
})).filter((group) => group.articles.length > 0);

export default {
  articles,
  history,
  historyYears,
  years,
  categories,
  featured,
  latest,
  more,
  counts: {
    articles: articles.length,
    featured: featured ? 1 : 0,
    latest: latest.length,
    more: more.length,
    history: history.length,
    years: years.length,
  },
  /** Old `news.html#article-…` anchors still resolve after the migration. */
  redirects: Object.fromEntries(
    [...articles, ...history]
      .filter((entry) => entry.legacyId && entry.permalink)
      .map((entry) => [entry.legacyId, entry.permalink]),
  ),
};

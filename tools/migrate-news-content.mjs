import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Stage 13 one-off migration.
 *
 * Splits the monolithic news.html into one source file per article:
 *   news/<year>/<slug>.md          current + 2025 news
 *   news/history/<slug>.md         historical archive items
 *
 * Article copy, headings, images and captions are copied verbatim. The only
 * edits are mechanical: the body keeps its markup, and image references are
 * re-prefixed for the generated URL depth (../../../ from /news/<year>/<slug>/).
 *
 * Run with --check to report what would be written without touching the tree.
 */
const root = process.cwd();
const checkOnly = process.argv.includes("--check");
/*
 * The monolithic page was replaced by the new landing page during Stage 13, so
 * the extractor can be pointed at an archived copy of it
 * (--source=news-monolith.html) to regenerate the content files.
 */
const sourceArgument = process.argv.find((value) => value.startsWith("--source="));
const sourceFile = sourceArgument ? sourceArgument.split("=")[1] : "news.html";
const source = await readFile(path.join(root, sourceFile), "utf8");

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/**
 * Depth-aware extraction of an element's inner HTML.
 * `startIndex` points at the opening `<tag` occurrence, so the opening tag
 * itself is counted and the function returns everything up to its match.
 */
function innerHtml(html, startIndex, tagName) {
  const open = new RegExp(`<${tagName}\\b`, "gi");
  const close = new RegExp(`</${tagName}>`, "gi");
  let depth = 0;
  let cursor = startIndex;
  while (cursor < html.length) {
    open.lastIndex = cursor;
    close.lastIndex = cursor;
    const nextOpen = open.exec(html);
    const nextClose = close.exec(html);
    if (!nextClose) return null;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + nextOpen[0].length;
      continue;
    }
    depth -= 1;
    if (depth === 0) return html.slice(startIndex, nextClose.index);
    cursor = nextClose.index + nextClose[0].length;
  }
  return null;
}

/** Returns the inner HTML of the first element matching `marker`. */
function contentOf(html, marker, tagName) {
  const index = html.indexOf(marker);
  if (index === -1) return null;
  return innerHtml(html, index, tagName);
}

const strip = (value) =>
  value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").replace(/&amp;/g, "&").trim();

function parseDate(text) {
  const value = strip(text).replace(/(\d+)(st|nd|rd|th)/i, "$1");
  const monthFirst = value.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  const dayFirst = value.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/);
  const parts = monthFirst
    ? [monthFirst[2], monthFirst[1], monthFirst[3]]
    : dayFirst
      ? [dayFirst[1], dayFirst[2], dayFirst[3]]
      : null;
  if (!parts) return null;
  const day = Number(parts[0]);
  const month = MONTHS[String(parts[1]).toLowerCase()];
  const year = Number(parts[2]);
  if (!month || !Number.isFinite(day) || !Number.isFinite(year)) return null;
  return { day, month, year, iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
}

const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/&amp;/g, " and ")
    .replace(/[’'"“”]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 8)
    .join("-");

const escapeYaml = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** /news/<depth>/<slug>/ pages live three levels below the site root. */
const rePrefixImages = (html) => html.replace(/(["'(])\.\/Images\//g, "$1../../../Images/");

/**
 * Sentence-level excerpt: the first complete sentence(s) that fit the limit.
 * Never cuts mid-word or mid-sentence — if the opening paragraph has no
 * sentence break inside the limit the whole paragraph is used.
 */
const excerptFrom = (html, limit = 240) => {
  const paragraph = html.match(/<p>([\s\S]*?)<\/p>/);
  if (!paragraph) return "";
  const text = strip(paragraph[1]);
  if (text.length <= limit) return text;
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)/g) ?? [];
  let excerpt = "";
  for (const sentence of sentences) {
    const candidate = `${excerpt} ${sentence}`.trim();
    if (excerpt && candidate.length > limit) break;
    excerpt = candidate;
  }
  return excerpt || sentences[0]?.trim() || text;
};

const articles = [];
const articlePattern = /<article\b[^>]*id="([^"]+)"[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/article>/g;
for (const match of source.matchAll(articlePattern)) {
  const [, id, classes, inner] = match;
  const titleMatch = inner.match(/<h3>([\s\S]*?)<\/h3>/);
  const dateMatch = inner.match(/<span class="news-date">[\s\S]*?<\/i>\s*([^<]+)<\/span>/);
  const categoryMatch = inner.match(/<span class="news-category">[\s\S]*?<\/i>\s*([^<]+)<\/span>/);
  const leadImage = inner.match(/\{%\s*photoImage\s+"([^"]+)",\s*"([^"]*)"/);
  const contentIndex = inner.indexOf('<div class="news-content">');
  const beforeContent = contentIndex === -1 ? inner : inner.slice(0, contentIndex);
  const leadBefore = beforeContent.match(/\{%\s*photoImage\s+"([^"]+)",\s*"([^"]*)"/) ?? leadImage;
  let body = contentOf(inner, '<div class="news-content">', "div") ?? "";
  body = body.replace(/<div class="news-meta">[\s\S]*?<\/div>\s*/i, "");
  const captionMatch = beforeContent.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/);

  const date = parseDate(dateMatch?.[1] ?? "");
  const title = strip(titleMatch?.[1] ?? "");
  const year = date?.year ?? 2025;
  const slugSource = id.replace(/^article-?/, "") || title;
  const slug = /^a?\d*$/.test(slugSource) ? slugify(title) : slugify(slugSource || title);

  articles.push({
    legacyId: id,
    featured: classes.includes("featured"),
    title,
    date,
    dateMissing: !date,
    dateText: strip(dateMatch?.[1] ?? ""),
    category: strip(categoryMatch?.[1] ?? ""),
    image: leadBefore?.[1] ?? null,
    imageAlt: strip(leadBefore?.[2] ?? ""),
    imageCaption: captionMatch ? strip(captionMatch[1]) : null,
    year,
    slug,
    permalink: `/news/${year}/${slug}/`,
    excerpt: excerptFrom(body),
    body,
    bodyBytes: Buffer.byteLength(body),
    headingCount: (body.match(/<h[2-6][^>]*>/g) ?? []).length,
    imageCount: (body.match(/\{%\s*photoImage/g) ?? []).length + (leadBefore ? 1 : 0),
  });
}

const history = [];
const historyCardPattern =
  /<div[^>]*class="news-card"[^>]*data-history-article="([^"]+)"[\s\S]*?<div class="news-card-date">([^<]*)<\/div>[\s\S]*?<h3>([\s\S]*?)<\/h3>/g;
const historyCards = new Map();
for (const match of source.matchAll(historyCardPattern)) {
  historyCards.set(match[1], { dateText: strip(match[2]), title: strip(match[3]) });
}

const historyOpenPattern = /<div\b[^>]*id="(history-[^"]+)"[^>]*class="history-item[^"]*"[^>]*>/g;
for (const match of source.matchAll(historyOpenPattern)) {
  const id = match[1];
  const inner = innerHtml(source, match.index, "div");
  if (!inner) continue;
  const article = contentOf(inner, '<article class="historical-article">', "article") ?? inner;
  const card = historyCards.get(id);
  const date = parseDate(card?.dateText ?? "");
  const leadImage = article.match(/\{%\s*photoImage\s+"([^"]+)",\s*"([^"]*)"/);
  const title = card?.title ?? strip((article.match(/<h3>([\s\S]*?)<\/h3>/) ?? [])[1] ?? "");
  const slug = slugify(`${date?.year ?? ""} ${title}`);
  history.push({
    legacyId: id,
    title,
    date,
    dateText: card?.dateText ?? "",
    year: date?.year ?? null,
    slug,
    permalink: `/news/history/${slug}/`,
    image: leadImage?.[1] ?? null,
    imageAlt: strip(leadImage?.[2] ?? ""),
    excerpt: excerptFrom(article),
    body: article,
    bodyBytes: Buffer.byteLength(article),
    headingCount: (article.match(/<h[2-6][^>]*>/g) ?? []).length,
    imageCount: (article.match(/\{%\s*photoImage/g) ?? []).length,
  });
}

const manifest = {
  generatedAt: new Date().toISOString(),
  source: sourceFile,
  counts: {
    articles: articles.length,
    articles2026: articles.filter((entry) => entry.year === 2026).length,
    articles2025: articles.filter((entry) => entry.year === 2025).length,
    articlesOtherYear: articles.filter((entry) => ![2025, 2026].includes(entry.year)).length,
    historyItems: history.length,
    missingDates: articles.filter((entry) => !entry.date).map((entry) => entry.legacyId),
    missingImages: articles.filter((entry) => !entry.image).map((entry) => entry.legacyId),
    duplicateSlugs: [
      ...articles
        .map((entry) => `${entry.year}/${entry.slug}`)
        .filter((value, index, list) => list.indexOf(value) !== index),
    ],
  },
  articles: articles.map(({ body, ...rest }) => rest),
  history: history.map(({ body, ...rest }) => rest),
};

if (!checkOnly) {
  // Only generated markdown is replaced; templates in these directories stay.
  for (const directory of ["news/2026", "news/2025", "news/history"]) {
    const target = path.join(root, directory);
    for (const entry of await readdir(target).catch(() => [])) {
      if (entry.endsWith(".md")) {
        await rm(path.join(target, entry), { force: true });
      }
    }
  }

  for (const entry of articles) {
    const directory = path.join(root, "news", String(entry.year));
    await mkdir(directory, { recursive: true });
    const frontMatter = [
      "---",
      `title: ${escapeYaml(entry.title)}`,
      // No publication date is invented: one card carries a category label
      // ("New Archive Added") instead of a date, so it keeps none.
      entry.date ? `date: ${entry.date.iso}` : null,
      // Quoted: unquoted ISO values are parsed as YAML timestamps, which then
      // render as JavaScript Date strings (GMT, timezone names) on the page.
      `isoDate: ${escapeYaml(entry.date?.iso ?? "")}`,
      entry.dateText ? `displayDate: ${escapeYaml(entry.dateText)}` : null,
      `category: ${escapeYaml(entry.category)}`,
      `year: ${entry.year}`,
      `excerpt: ${escapeYaml(entry.excerpt)}`,
      entry.image ? `image: ${escapeYaml(entry.image)}` : null,
      entry.imageAlt ? `imageAlt: ${escapeYaml(entry.imageAlt)}` : null,
      entry.imageCaption ? `imageCaption: ${escapeYaml(entry.imageCaption)}` : null,
      `featured: ${entry.featured}`,
      "newsSection: current",
      `legacyId: ${escapeYaml(entry.legacyId)}`,
      `permalink: ${escapeYaml(entry.permalink)}`,
      "layout: news-article.njk",
      "tags: newsArticle",
      "---",
      "",
    ]
      .filter(Boolean)
      .join("\n");
    await writeFile(
      path.join(directory, `${entry.slug}.md`),
      `${frontMatter}${rePrefixImages(entry.body).trim()}\n`,
      "utf8",
    );
  }

  const historyDirectory = path.join(root, "news", "history");
  await mkdir(historyDirectory, { recursive: true });
  for (const entry of history) {
    const frontMatter = [
      "---",
      `title: ${escapeYaml(entry.title)}`,
      entry.date ? `date: ${entry.date.iso}` : null,
      entry.date ? `isoDate: ${escapeYaml(entry.date.iso)}` : null,
      entry.date ? `historicalDate: ${escapeYaml(entry.dateText)}` : null,
      entry.year ? `year: ${entry.year}` : null,
      `excerpt: ${escapeYaml(entry.excerpt)}`,
      entry.image ? `image: ${escapeYaml(entry.image)}` : null,
      entry.imageAlt ? `imageAlt: ${escapeYaml(entry.imageAlt)}` : null,
      "archiveCategory: Historical",
      "newsSection: history",
      `legacyId: ${escapeYaml(entry.legacyId)}`,
      `permalink: ${escapeYaml(entry.permalink)}`,
      "layout: news-article.njk",
      "tags: newsHistory",
      "---",
      "",
    ]
      .filter(Boolean)
      .join("\n");
    await writeFile(
      path.join(historyDirectory, `${entry.slug}.md`),
      `${frontMatter}${rePrefixImages(entry.body).trim()}\n`,
      "utf8",
    );
  }

  await mkdir(path.join(root, "reports", "stage13"), { recursive: true });
  await writeFile(
    path.join(root, "reports", "stage13", "migration-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

console.log(JSON.stringify(manifest.counts, null, 1));
console.log("\narticles:");
for (const entry of manifest.articles) {
  console.log(
    `  ${entry.year} ${entry.permalink.padEnd(52)} ${entry.category.padEnd(18)} ${entry.title.slice(0, 44)}`,
  );
}
console.log("\nhistory:");
for (const entry of manifest.history) {
  console.log(`  ${entry.year ?? "----"} ${entry.permalink.padEnd(52)} ${entry.title.slice(0, 50)}`);
}

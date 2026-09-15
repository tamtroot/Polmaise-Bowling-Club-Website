import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Stage 13 — front-matter tidy-up for the migrated news articles.
 *
 * The migration copied the wording the old single news page used, which left
 * every article with duplicated/again-stale fields:
 *
 *   - `displayDate` / `historicalDate`: four different date styles that drifted
 *     from the ISO date the archive sorts and the <time> element publishes;
 *   - `featured: true` on all twelve 2026 stories, so "the featured story"
 *     meant nothing.
 *
 * This tool rewrites only the front-matter block. Article bodies are copied
 * byte for byte. Human-readable dates are derived at build time from `isoDate`
 * (tools/news-dates.mjs), so `displayDate`/`historicalDate` are removed rather
 * than reformatted — there is one date, and one way to write it.
 *
 * Usage:
 *   node tools/normalise-news-frontmatter.mjs            # write the files
 *   node tools/normalise-news-frontmatter.mjs --check    # report drift only
 */

const projectRoot = process.cwd();
const newsRoot = path.join(projectRoot, "news");
const isCheckOnly = process.argv.includes("--check");

/**
 * The one article that leads the landing page. It is the newest story, so the
 * homepage and the landing page agree without any other curation.
 */
const FEATURED_PERMALINK = "/news/2026/chucks-memorial-2026/";

const QUOTED_KEYS = new Set([
  "title",
  "date",
  "isoDate",
  "category",
  "archiveCategory",
  "excerpt",
  "image",
  "imageAlt",
  "imageCaption",
  "imageType",
  "newsSection",
  "legacyId",
  "permalink",
  "layout",
  "templateEngineOverride",
]);

const ORDER = [
  "title",
  "date",
  "isoDate",
  "category",
  "archiveCategory",
  "year",
  "excerpt",
  "image",
  "imageAlt",
  "imageCaption",
  "imageType",
  "featured",
  "newsSection",
  "legacyId",
  "permalink",
  "layout",
  "templateEngineOverride",
  "tags",
];

/**
 * The article bodies are HTML fragments lifted from the old news page, not
 * markdown. Rendering them as Nunjucks (the body still uses the `photoImage`
 * shortcode) keeps markdown from wrapping stray text in its own <p> elements,
 * which is what produced the duplicate/implicitly-closed paragraphs on every
 * article page.
 */
const TEMPLATE_ENGINE_OVERRIDE = "njk";

const DROPPED_KEYS = new Set(["displayDate", "historicalDate"]);

function quote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const stripTags = (html) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/**
 * A handful of historical items carry a photo credit as their first paragraph
 * ("Photo by Bennett, St. Ninians."), which the migration copied into `excerpt`.
 * That is too short to be a meta description, so those items borrow the opening
 * sentence of the report they introduce — the article's own words, not new
 * editorial copy.
 */
function excerptFromBody(body, limit = 240) {
  const paragraphs = [...body.matchAll(/<p>([\s\S]*?)<\/p>/g)]
    .map((match) => stripTags(match[1]))
    .filter(Boolean);
  const text = paragraphs.find((paragraph) => paragraph.length >= 60) ?? paragraphs[0] ?? "";
  if (text.length <= limit) return text;

  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)/g) ?? [];
  let excerpt = "";
  for (const sentence of sentences) {
    const candidate = `${excerpt} ${sentence}`.trim();
    if (excerpt && candidate.length > limit) break;
    excerpt = candidate;
  }
  return excerpt || sentences[0]?.trim() || text;
}

function parseFrontMatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("Article is missing a front-matter block");

  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const entry = line.match(/^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
    if (!entry) continue;
    const [, key, rawValue] = entry;
    if (key === "tags") {
      data.tags = rawValue
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      continue;
    }
    const value = rawValue.trim();
    data[key] =
      value.startsWith('"') && value.endsWith('"')
        ? value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
        : value;
  }

  return { data, body: source.slice(match[0].length) };
}

function renderFrontMatter(data, eol) {
  const lines = ["---"];

  for (const key of ORDER) {
    if (DROPPED_KEYS.has(key)) continue;
    if (!(key in data) || data[key] === undefined || data[key] === null || data[key] === "") {
      // `isoDate: ""` is deliberate for the one undated announcement: it keeps
      // that story at the end of the stream instead of falling back to the
      // file timestamp.
      if (!(key === "isoDate" && data[key] === "")) continue;
    }

    if (key === "tags") {
      lines.push(`tags: ${data.tags.join(", ")}`);
      continue;
    }
    if (key === "year" || key === "featured") {
      lines.push(`${key}: ${data[key]}`);
      continue;
    }
    lines.push(`${key}: ${QUOTED_KEYS.has(key) ? quote(data[key]) : data[key]}`);
  }

  lines.push("---");
  return lines.join(eol);
}

const files = [];
for (const entry of await readdir(newsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = path.join(newsRoot, entry.name);
  for (const file of await readdir(directory, { withFileTypes: true })) {
    if (file.isFile() && file.name.endsWith(".md")) {
      files.push(path.join(directory, file.name));
    }
  }
}
files.sort();

const changed = [];
const problems = [];

for (const file of files) {
  const relative = path.relative(projectRoot, file).split(path.sep).join("/");
  const source = await readFile(file, "utf8");
  const { data, body } = parseFrontMatter(source);

  if (!data.permalink) {
    problems.push(`${relative}: missing permalink`);
    continue;
  }
  if (!data.isoDate && data.isoDate !== "") {
    problems.push(`${relative}: missing isoDate`);
    continue;
  }
  if (data.date && data.date !== data.isoDate) {
    problems.push(`${relative}: date (${data.date}) does not match isoDate (${data.isoDate})`);
  }

  const tidy = { ...data, date: data.isoDate };
  if (tidy.isoDate === "") delete tidy.date;
  tidy.templateEngineOverride = TEMPLATE_ENGINE_OVERRIDE;

  if (stripTags(String(data.excerpt ?? "")).length < 50) {
    const derived = excerptFromBody(body);
    if (derived) tidy.excerpt = derived;
  }

  if (data.featured === "true" && data.permalink !== FEATURED_PERMALINK) {
    delete tidy.featured;
  }
  if (data.permalink === FEATURED_PERMALINK) {
    tidy.featured = true;
  }

  // Keep the file's own line endings so the rewrite never mixes CRLF and LF
  // inside one article.
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const next = `${renderFrontMatter(tidy, eol)}${eol}${body.replace(/^\r?\n/, "")}`;
  if (next === source) {
    continue;
  }

  changed.push(relative);
  if (!isCheckOnly) {
    await writeFile(file, next, "utf8");
  }
}

for (const problem of problems) {
  console.error(`PROBLEM ${problem}`);
}

console.log(
  `${isCheckOnly ? "Would rewrite" : "Rewrote"} ${changed.length} of ${files.length} article files`,
);
for (const file of changed) {
  console.log(`  ${file}`);
}

if (problems.length > 0) {
  process.exitCode = 1;
}

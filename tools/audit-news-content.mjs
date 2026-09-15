import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Stage 13 pre-work: inventory everything currently embedded in news.html so
 * the migration is driven by counts rather than by eyeballing the page.
 *
 * Reports current news cards, article bodies, 2025 archive items, historical
 * archive items, headings, images and anchors.
 */
const root = process.cwd();
const source = await readFile(path.join(root, "news.html"), "utf8");

const count = (pattern) => [...source.matchAll(pattern)].length;
const collect = (pattern, mapper) => [...source.matchAll(pattern)].map(mapper);

const sections = collect(/<section\b[^>]*class="([^"]*)"[^>]*>/g, (match) => match[1]);

const newsCards = collect(
  /<div[^>]*class="news-card"[^>]*data-news-article="([^"]*)"[\s\S]{0,900}?<h3>([\s\S]*?)<\/h3>/g,
  (match) => ({
    id: match[1],
    title: match[2].replace(/\s+/g, " ").replace(/<[^>]+>/g, "").trim(),
  }),
);

const articleBodies = collect(
  /<article[^>]*id="([^"]*)"[^>]*class="([^"]*)"[^>]*>\s*<h3>([\s\S]*?)<\/h3>/g,
  (match) => ({
    id: match[1],
    classes: match[2],
    title: match[3].replace(/\s+/g, " ").replace(/<[^>]+>/g, "").trim(),
  }),
);

const historyCards = collect(
  /<div[^>]*class="news-card"[^>]*data-history-article="([^"]*)"[\s\S]{0,2000}?<h3>([\s\S]*?)<\/h3>/g,
  (match) => ({
    id: match[1],
    title: match[2].replace(/\s+/g, " ").replace(/<[^>]+>/g, "").trim(),
  }),
);

const historyItems = collect(
  /<div[^>]*class="history-item[^"]*"[^>]*id="([^"]*)"[^>]*>|<div[^>]*id="(history-[^"]*)"[^>]*class="history-item[^"]*"[^>]*>/g,
  (match) => match[1] ?? match[2],
);

const headings = collect(/<h([2-4])[^>]*>([\s\S]*?)<\/h\1>/g, (match) => ({
  level: Number(match[1]),
  text: match[2].replace(/\s+/g, " ").replace(/<[^>]+>/g, "").trim().slice(0, 90),
}));

const images = collect(/<img[^>]*src="([^"]*)"/g, (match) => decodeURIComponent(match[1]));
const photoCalls = collect(
  /\{%\s*(photoImage|photoGraphic)\s+"([^"]+)",\s*"([^"]*)"/g,
  (match) => ({ kind: match[1], src: match[2], alt: match[3].slice(0, 80) }),
);
const anchors = collect(/id="([^"]+)"/g, (match) => match[1]);
const dateLabels = collect(/class="news-card-date">([^<]+)</g, (match) => match[1].trim());
const articleDates = collect(/class="news-date"><i[^>]*><\/i>\s*([^<]+)</g, (match) =>
  match[1].trim(),
);
const categories = collect(/class="news-category"><i[^>]*><\/i>\s*([^<]+)</g, (match) =>
  match[1].trim(),
);

const report = {
  generatedAt: new Date().toISOString(),
  sourceBytes: source.length,
  sourceLines: source.split(/\r?\n/).length,
  counts: {
    sections: sections.length,
    newsCards: newsCards.length,
    articleBodies: articleBodies.length,
    historyCards: historyCards.length,
    historyItems: historyItems.length,
    headings: headings.length,
    images: images.length,
    photoCalls: photoCalls.length,
    photoImage: photoCalls.filter((call) => call.kind === "photoImage").length,
    photoGraphic: photoCalls.filter((call) => call.kind === "photoGraphic").length,
    ids: anchors.length,
  },
  sections,
  newsCards,
  articleBodies,
  historyCards,
  historyItems,
  headings,
  images,
  photoCalls,
  anchors,
  dateLabels,
  articleDates,
  categories,
  categoryTally: Object.entries(
    categories.reduce((tally, value) => {
      tally[value] = (tally[value] ?? 0) + 1;
      return tally;
    }, {}),
  ).sort((left, right) => right[1] - left[1]),
};

const reportRoot = path.join(root, "reports", "stage13");
await mkdir(reportRoot, { recursive: true });
await writeFile(
  path.join(reportRoot, "news-inventory.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

console.log(`news.html: ${report.sourceLines} lines, ${(source.length / 1024).toFixed(1)} KiB`);
console.log(JSON.stringify(report.counts, null, 1));
console.log("\nsections:", sections.join(", "));
console.log("\nnews cards (" + newsCards.length + "):");
for (const card of newsCards) console.log(`  ${card.id}  ${card.title.slice(0, 70)}`);
console.log("\narticle bodies (" + articleBodies.length + "):");
for (const article of articleBodies) console.log(`  ${article.id} [${article.classes}]  ${article.title.slice(0, 70)}`);
console.log("\nhistory cards (" + historyCards.length + "):");
for (const card of historyCards) console.log(`  ${card.id}  ${card.title.slice(0, 70)}`);
console.log("\nhistory items (" + historyItems.length + "):", historyItems.join(", "));
console.log("\ncategory tally:", JSON.stringify(report.categoryTally));
console.log("\nrecent card dates:", dateLabels.slice(0, 12).join(" | "));
console.log("article dates:", articleDates.slice(0, 12).join(" | "));

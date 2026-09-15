import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Stage 16 release audit (read-only).
 *
 * The SEO specs audit the sampled `SITE_PAGES` set; this walks *every* page in
 * the build (68 today, including the generated news pages) and checks unique
 * titles/descriptions/canonicals, required social metadata, valid JSON-LD,
 * development URLs, accidental noindex, canonical correctness and sitemap
 * coverage. Run it before a release:
 *
 *   node tools/audit-seo-release.mjs        # expect "problems: 0"
 */
const siteRoot = path.resolve(process.env.SITE_ROOT ?? "_site");
const site = JSON.parse(readFileSync(path.join(process.cwd(), "_data", "site.json"), "utf8"));

const files = [];
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".html")) files.push(full);
  }
};
walk(siteRoot);

const problems = [];
const titles = new Map();
const descriptions = new Map();
const canonicals = new Map();
const pageUrls = new Set();

const devUrl = /(?:localhost|127\.0\.0\.1|file:\/\/|[A-Za-z]:\\|[^\s"]*_site-alt[^\s"]*)/i;

for (const file of files) {
  const html = readFileSync(file, "utf8");
  const relative = path.relative(siteRoot, file).split(path.sep).join("/");
  const url = relative === "index.html" ? "/" : `/${relative.replace(/index\.html$/, "")}`;
  pageUrls.add(url);

  const first = (pattern) => html.match(pattern)?.[1]?.trim() ?? "";
  const title = first(/<title>([^<]*)<\/title>/);
  const description = first(/<meta name="description" content="([^"]*)"/);
  const canonical = first(/<link rel="canonical" href="([^"]*)"/);
  const ogImage = first(/<meta property="og:image" content="([^"]*)"/);
  const twitterCard = first(/<meta name="twitter:card" content="([^"]*)"/);
  const robots = first(/<meta name="robots" content="([^"]*)"/);
  const jsonLd = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];

  if (!title) problems.push(`${url}: missing title`);
  if (title.length > 70) problems.push(`${url}: title is ${title.length} chars`);
  if (!description || description.length < 50) problems.push(`${url}: description too short`);
  if (!canonical) problems.push(`${url}: missing canonical`);
  if (!canonical.startsWith(`${site.url}/`)) problems.push(`${url}: canonical is not absolute (${canonical})`);
  if (!ogImage.startsWith(`${site.url}/`)) problems.push(`${url}: og:image is not absolute`);
  if (!twitterCard) problems.push(`${url}: missing twitter:card`);
  if (/noindex/i.test(robots)) problems.push(`${url}: has a noindex robots meta`);
  if (jsonLd.length === 0) problems.push(`${url}: no JSON-LD`);
  for (const block of jsonLd) {
    try {
      JSON.parse(block[1]);
    } catch (error) {
      problems.push(`${url}: invalid JSON-LD (${error.message})`);
    }
  }
  if (devUrl.test(html)) problems.push(`${url}: contains a development URL or path`);

  const expectedCanonical = `${site.url}${url.replace(/ /g, "%20")}`;
  if (canonical && canonical !== expectedCanonical) {
    problems.push(`${url}: canonical ${canonical} != ${expectedCanonical}`);
  }

  for (const [map, value, label] of [
    [titles, title, "title"],
    [descriptions, description, "description"],
    [canonicals, canonical, "canonical"],
  ]) {
    if (!value) continue;
    if (map.has(value)) problems.push(`${url}: ${label} duplicated with ${map.get(value)}`);
    else map.set(value, url);
  }
}

const sitemap = readFileSync(path.join(siteRoot, "sitemap.xml"), "utf8");
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const expected = [...pageUrls].map((url) => `${site.url}${url.replace(/ /g, "%20")}`).sort();
const missing = expected.filter((url) => !locs.includes(url));
const unexpected = locs.filter((url) => !expected.includes(url));
const robots = readFileSync(path.join(siteRoot, "robots.txt"), "utf8");

console.log(`pages scanned: ${files.length}`);
console.log(`unique titles: ${titles.size} | unique descriptions: ${descriptions.size} | unique canonicals: ${canonicals.size}`);
console.log(`sitemap URLs: ${locs.length} | missing: ${missing.length} | unexpected: ${unexpected.length}`);
console.log(`robots.txt references sitemap: ${robots.includes(`Sitemap: ${site.url}/sitemap.xml`)}`);
console.log(`problems: ${problems.length}`);
for (const problem of problems.slice(0, 25)) console.log(`  ${problem}`);

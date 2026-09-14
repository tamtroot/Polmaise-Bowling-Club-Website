import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { SITE_PAGES } from "../tests/helpers/site-pages.mjs";

// Stage 8 pre-work: find dead CSS selectors, unused JS hooks, orphaned files
// and development files that would leak into the deployed artifact.
const root = process.cwd();
const ignored = /(?:node_modules|_site|\.cache|reports|test-results|playwright-report|\.git)/;

async function walk(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (ignored.test(path.relative(root, fullPath))) continue;
    if (entry.isDirectory()) await walk(fullPath, files);
    else files.push(fullPath);
  }
  return files;
}

const allFiles = await walk(root);
const byExtension = new Map();
for (const file of allFiles) {
  const extension = path.extname(file).toLowerCase();
  byExtension.set(extension, [...(byExtension.get(extension) ?? []), file]);
}

const markupFiles = [
  ...(byExtension.get(".html") ?? []),
  ...(byExtension.get(".njk") ?? []),
];
const codeFiles = [...(byExtension.get(".js") ?? []), ...(byExtension.get(".njk") ?? [])];
const dataFiles = byExtension.get(".json") ?? [];

const markup = (await Promise.all(markupFiles.map((file) => readFile(file, "utf8")))).join("\n");
const code = (await Promise.all(codeFiles.map((file) => readFile(file, "utf8")))).join("\n");
const data = (await Promise.all(dataFiles.map((file) => readFile(file, "utf8")))).join("\n");

// CSS selectors: class/id tokens collected from every stylesheet in the repo.
const cssFiles = [...(byExtension.get(".css") ?? []), ...markupFiles];
const selectors = new Map();
for (const file of cssFiles) {
  const source = await readFile(file, "utf8");
  const cssBlocks = file.endsWith(".html")
    ? [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join("\n")
    : source;
  for (const match of cssBlocks.matchAll(/\.(-?[_a-zA-Z][\w-]*)|#(-?[_a-zA-Z][\w-]*)/g)) {
    const token = match[1] ?? match[2];
    // Skip hex colour values captured as ids (e.g. #FFFFFF).
    if (/^[0-9a-f]{3,8}$/i.test(token)) continue;
    if (!selectors.has(token)) selectors.set(token, new Set());
    selectors.get(token).add(path.relative(root, file));
  }
}

const haystack = `${markup}\n${code}\n${data}`;
const unusedSelectors = [...selectors.entries()]
  .filter(([token]) => {
    const pattern = new RegExp(`(?:["'\\s.#])${token.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}(?:["'\\s.:\\[{,)]|$)`, "m");
    return !pattern.test(haystack);
  })
  .map(([token, files]) => ({ token, declaredIn: [...files].sort() }));

// JS data-attribute hooks: are the selectors used in markup or data?
const jsSource = (await Promise.all((byExtension.get(".js") ?? []).map((file) => readFile(file, "utf8")))).join("\n");
const jsHooks = [...new Set([...jsSource.matchAll(/\[data-([a-z0-9-]+)\]/gi)].map((match) => match[1]))];
const markupAndData = `${markup}\n${data}`;
const unusedJsHooks = jsHooks.filter((hook) => !markupAndData.includes(`data-${hook}`));

// Ids referenced by aria-controls/labelledby must exist somewhere.
const ariaReferences = [...markup.matchAll(/aria-(?:controls|labelledby)="([^"]+)"/g)].flatMap((match) =>
  match[1].split(/\s+/),
);
const idsInMarkup = new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const brokenAriaReferences = ariaReferences.filter((id) => !idsInMarkup.has(id));

// Public pages that are not covered by the test page list.
const pageFiles = SITE_PAGES.map((page) => decodeURIComponent(page.path.replace(/^\//, "")));
const htmlFiles = (byExtension.get(".html") ?? [])
  .map((file) => path.relative(root, file).split(path.sep).join("/"))
  .sort();
const uncoveredPages = htmlFiles.filter((file) => !pageFiles.includes(file));

console.log(
  JSON.stringify(
    {
      fileCounts: Object.fromEntries([...byExtension.entries()].map(([extension, files]) => [extension, files.length])),
      unusedSelectorCount: unusedSelectors.length,
      unusedSelectors: unusedSelectors.slice(0, 40),
      jsHooks,
      unusedJsHooks,
      brokenAriaReferences,
      htmlFiles,
      uncoveredPages,
    },
    null,
    2,
  ),
);

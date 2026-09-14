import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// Stage 9 pre-work: inventory the current visual language and the inline-style debt.
const root = process.cwd();
const ignored = /(?:node_modules|_site|_site-alt|\.cache|reports|test-results|playwright-report|\.git|Images|downloads)/;

async function walk(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    const relative = path.relative(root, fullPath).split(path.sep).join("/");
    if (ignored.test(relative)) continue;
    if (entry.isDirectory()) await walk(fullPath, files);
    else files.push(fullPath);
  }
  return files;
}

const files = await walk(root);
const htmlFiles = files.filter((file) => file.endsWith(".html") || file.endsWith(".njk"));
const cssFiles = files.filter((file) => file.endsWith(".css"));

const css = (await Promise.all(cssFiles.map((file) => readFile(file, "utf8")))).join("\n");
const pageStyles = [];
for (const file of htmlFiles) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    pageStyles.push({ file: path.relative(root, file), css: match[1] });
  }
}
const allCss = `${css}\n${pageStyles.map((entry) => entry.css).join("\n")}`;

const tally = (pattern, valueIndex = 0) => {
  const counts = new Map();
  for (const match of allCss.matchAll(pattern)) {
    const key = match[valueIndex].trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
};

const inlineStyles = [];
for (const file of htmlFiles) {
  const source = await readFile(file, "utf8");
  const count = [...source.matchAll(/<[^>]+\sstyle="[^"]*"/g)].length;
  if (count > 0) inlineStyles.push({ file: path.relative(root, file).split(path.sep).join("/"), count });
}

const mediaQueries = new Map();
for (const match of allCss.matchAll(/@media[^{]+/g)) {
  const query = match[0].replace(/\s+/g, " ").trim();
  mediaQueries.set(query, (mediaQueries.get(query) ?? 0) + 1);
}

console.log(
  JSON.stringify(
    {
      cssBytes: {
        styles: css.length,
        pageStyles: pageStyles.reduce((total, entry) => total + entry.css.length, 0),
      },
      colours: tally(/#[0-9a-f]{6}\b/gi),
      customProperties: [...new Set([...allCss.matchAll(/--([a-z0-9-]+)\s*:/gi)].map((match) => match[1]))].sort(),
      fontFamilies: tally(/font-family:\s*([^;]+);/gi, 1),
      radii: tally(/border-radius:\s*([^;]+);/gi, 1),
      shadows: tally(/box-shadow:\s*([^;]+);/gi, 1).slice(0, 12),
      transitions: tally(/transition:\s*([^;]+);/gi, 1).slice(0, 12),
      spacing: tally(/(?:padding|margin|gap):\s*([^;]+);/gi, 1).slice(0, 20),
      mediaQueries: [...mediaQueries.entries()].sort((left, right) => right[1] - left[1]).slice(0, 14),
      inlineStyleTotal: inlineStyles.reduce((total, entry) => total + entry.count, 0),
      inlineStyles: inlineStyles.sort((left, right) => right.count - left.count),
    },
    null,
    2,
  ),
);

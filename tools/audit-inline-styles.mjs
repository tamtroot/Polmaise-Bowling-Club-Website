import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

// Stage 9: inventory of inline style attributes in templates, used to track the
// presentation-only inline styles migration.
const root = process.cwd();
const ignored = /(?:node_modules|_site|_site-alt|\.cache|reports|test-results|playwright-report|\.git|Images|downloads)/;

async function walk(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    const relative = path.relative(root, fullPath).split(path.sep).join("/");
    if (ignored.test(relative)) continue;
    if (entry.isDirectory()) await walk(fullPath, files);
    else if (/\.(?:html|njk)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

const files = await walk(root);
const report = [];
let total = 0;

for (const file of files) {
  const source = await readFile(file, "utf8");
  const matches = [...source.matchAll(/<[^>]+\sstyle="([^"]*)"/g)];
  if (!matches.length) continue;
  const relative = path.relative(root, file).split(path.sep).join("/");
  const entries = matches.map((match) => {
    const line = source.slice(0, match.index).split(/\r?\n/).length;
    return { line, value: match[1].trim(), tag: match[0].trim().slice(0, 160) };
  });
  total += entries.length;
  report.push({ file: relative, count: entries.length, entries });
}

console.log(`Inline style attributes in templates: ${total} across ${report.length} files`);
for (const entry of report) {
  console.log(`\n### ${entry.file} (${entry.count})`);
  for (const item of entry.entries) {
    console.log(`  line ${item.line}: ${item.value}`);
  }
}

if (process.argv.includes("--json")) {
  const reportRoot = path.join(root, "reports", "stage9");
  await mkdir(reportRoot, { recursive: true });
  await writeFile(
    path.join(reportRoot, "inline-styles.json"),
    `${JSON.stringify({ total, files: report }, null, 2)}\n`,
    "utf8",
  );
  console.log("\nWrote reports/stage9/inline-styles.json");
}

// The rendered site can still contain inline styles produced by template
// options (for example a per-image focal point), so count those too.
if (process.argv.includes("--built")) {
  const siteRoot = path.join(root, process.env.SITE_ROOT ?? "_site");
  let builtTotal = 0;
  const walkBuilt = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walkBuilt(fullPath);
      } else if (entry.name.endsWith(".html")) {
        const source = await readFile(fullPath, "utf8");
        const matches = [...source.matchAll(/<[^>]+\sstyle="([^"]*)"/g)];
        for (const match of matches) {
          builtTotal += 1;
          console.log(
            `  built: ${path.relative(siteRoot, fullPath)} :: ${match[1].trim()} :: ${match[0].replace(/\s+/g, " ").slice(0, 120)}`,
          );
        }
      }
    }
  };
  await walkBuilt(siteRoot);
  console.log(`\nRendered pages: ${builtTotal} inline style attributes (source templates: ${total})`);
}

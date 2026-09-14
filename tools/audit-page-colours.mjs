import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

// Stage 9: lists every hard-coded presentation colour in the page-level
// <style> blocks (and optionally styles.css) with its selector, so the
// migration to semantic tokens is driven by data rather than guesswork.
const root = process.cwd();
const ignored = /(?:node_modules|_site|_site-alt|\.cache|reports|test-results|playwright-report|\.git|Images|downloads)/;

// Colours that are intentional brand values and have no semantic token yet.
const NAMED_COLOURS =
  /\b(?:white|black|silver|gray|grey|red|maroon|yellow|olive|lime|green|aqua|teal|blue|navy|fuchsia|purple)\b/i;
const COLOUR_VALUE = /#[0-9a-f]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/i;

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

/** Very small CSS block splitter: enough for hand-written page style blocks. */
function extractRules(css) {
  const rules = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = pattern.exec(stripped)) !== null) {
    const selector = match[1].replace(/\s+/g, " ").trim();
    if (!selector || selector.startsWith("@")) continue;
    rules.push({ selector, declarations: match[2] });
  }
  return rules;
}

function colourDeclarations(css) {
  const found = [];
  for (const rule of extractRules(css)) {
    for (const declaration of rule.declarations.split(";")) {
      const [property, ...rest] = declaration.split(":");
      const value = rest.join(":").trim();
      if (!value) continue;
      const key = property.trim().toLowerCase();
      const isColourProperty = /(?:^|-)color$|^background$|border|shadow|outline|fill|stroke/.test(key);
      const hasLiteral = COLOUR_VALUE.test(value);
      const hasNamed = /(?:^|-)color$|^background/.test(key) && NAMED_COLOURS.test(value);
      if ((isColourProperty && hasLiteral) || hasNamed || (isColourProperty && /\btransparent\b|\bcurrentcolor\b/i.test(value))) {
        found.push({ selector: rule.selector, property: key, value });
      }
    }
  }
  return found;
}

const files = await walk(root);
const report = [];

for (const file of files) {
  const source = await readFile(file, "utf8");
  const relative = path.relative(root, file).split(path.sep).join("/");
  for (const match of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const css = match[1];
    const declarations = colourDeclarations(css);
    if (declarations.length) {
      report.push({ file: relative, bytes: css.length, declarations });
    }
  }
}

const literals = new Map();
for (const entry of report) {
  for (const declaration of entry.declarations) {
    for (const value of declaration.value.match(/#[0-9a-f]{3,8}\b|\brgba?\([^)]*\)/gi) ?? []) {
      const key = value.toLowerCase();
      if (!literals.has(key)) literals.set(key, new Set());
      literals.get(key).add(entry.file);
    }
  }
}

const totals = {
  files: report.length,
  declarations: report.reduce((total, entry) => total + entry.declarations.length, 0),
  distinctLiterals: literals.size,
};

console.log(
  `Page-level colour declarations: ${totals.declarations} across ${totals.files} pages (${totals.distinctLiterals} distinct literal values)`,
);
for (const [value, files2] of [...literals.entries()].sort((l, r) => r[1].size - l[1].size)) {
  console.log(`  ${value} — ${files2.size} page(s)`);
}

if (process.argv.includes("--detail")) {
  for (const entry of report) {
    console.log(`\n### ${entry.file} (${entry.bytes}B)`);
    for (const declaration of entry.declarations) {
      console.log(`  ${declaration.selector} { ${declaration.property}: ${declaration.value} }`);
    }
  }
}

if (process.argv.includes("--json")) {
  const reportRoot = path.join(root, "reports", "stage9");
  await mkdir(reportRoot, { recursive: true });
  await writeFile(
    path.join(reportRoot, "page-colours.json"),
    `${JSON.stringify({ totals, files: report }, null, 2)}\n`,
    "utf8",
  );
  console.log(`\nWrote reports/stage9/page-colours.json`);
}

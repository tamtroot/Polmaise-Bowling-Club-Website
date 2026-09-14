import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Stage 8 cleanup: trim trailing whitespace from source files. Generated
// output, caches and audit reports are excluded.
const root = process.cwd();
const extensions = new Set([".html", ".njk", ".css", ".js", ".mjs", ".md", ".json", ".yml", ".yaml"]);
const ignored = /(?:node_modules|_site$|_site\/|_site-alt|\.cache|reports|test-results|playwright-report|\.git|Images|downloads)/;

async function walk(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    const relative = path.relative(root, fullPath).split(path.sep).join("/");
    if (ignored.test(relative)) continue;
    if (entry.isDirectory()) await walk(fullPath, files);
    else if (extensions.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }
  return files;
}

let changedFiles = 0;
let trimmedLines = 0;

for (const file of await walk(root)) {
  const source = await readFile(file, "utf8");
  const lines = source.split("\n");
  let fileTrimmed = 0;
  const updated = lines.map((line) => {
    const trimmed = line.replace(/[ \t]+$/, "");
    if (trimmed !== line) fileTrimmed += 1;
    return trimmed;
  });

  if (fileTrimmed > 0) {
    await writeFile(file, updated.join("\n"), "utf8");
    changedFiles += 1;
    trimmedLines += fileTrimmed;
    console.log(`${path.relative(root, file)}: ${fileTrimmed} lines`);
  }
}

console.log(`trimmed ${trimmedLines} lines across ${changedFiles} files`);

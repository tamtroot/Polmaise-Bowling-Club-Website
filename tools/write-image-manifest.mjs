import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// Records the archive as it stands so later runs can prove that no original
// photograph was modified, renamed or deleted during optimisation work.
const root = process.cwd();
const imagesRoot = path.join(root, "Images");
const outputPath = path.join(root, "reports", "stage6", "source-image-manifest.json");

async function walk(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath, relative)));
    } else {
      files.push(relative);
    }
  }
  return files;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

const relativePaths = (await walk(imagesRoot)).sort();
const entries = {};

for (const relative of relativePaths) {
  const fullPath = path.join(imagesRoot, relative);
  const fileStat = await stat(fullPath);
  entries[`Images/${relative}`] = {
    bytes: fileStat.size,
    sha256: await hashFile(fullPath),
  };
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify({ recordedAt: new Date().toISOString(), count: relativePaths.length, entries }, null, 2)}\n`,
  "utf8",
);

console.log(`Recorded ${relativePaths.length} source images in reports/stage6/source-image-manifest.json`);

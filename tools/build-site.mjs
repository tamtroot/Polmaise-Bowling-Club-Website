import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import Eleventy from "@11ty/eleventy";

const projectRoot = process.cwd();
const outputDirectory = path.resolve(projectRoot, "_site");

if (path.dirname(outputDirectory) !== projectRoot) {
  throw new Error(`Refusing to clean unexpected output directory: ${outputDirectory}`);
}

async function collectArtifactStats(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  let fileCount = 0;
  let totalBytes = 0;

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectArtifactStats(entryPath);
      fileCount += nested.fileCount;
      totalBytes += nested.totalBytes;
    } else if (entry.isFile()) {
      fileCount += 1;
      totalBytes += (await stat(entryPath)).size;
    }
  }

  return { fileCount, totalBytes };
}

await rm(outputDirectory, { recursive: true, force: true });

const eleventy = new Eleventy(".", "_site", {
  configPath: "eleventy.config.js",
});

await eleventy.write();

const artifact = await collectArtifactStats(outputDirectory);
const sizeInMiB = (artifact.totalBytes / 1024 ** 2).toFixed(2);

console.log(
  `Built ${artifact.fileCount} files into _site (${sizeInMiB} MiB).`,
);

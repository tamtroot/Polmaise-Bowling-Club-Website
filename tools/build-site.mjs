import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import Eleventy from "@11ty/eleventy";
import { generateSiteImages, loadSourceIndex } from "./image-pipeline.mjs";

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
    // stat() (rather than the dirent type) keeps hard-linked and OneDrive
    // placeholder files counted correctly on Windows.
    const entryStat = await stat(entryPath).catch(() => null);
    if (!entryStat) {
      continue;
    }
    if (entryStat.isDirectory()) {
      const nested = await collectArtifactStats(entryPath);
      fileCount += nested.fileCount;
      totalBytes += nested.totalBytes;
    } else if (entryStat.isFile()) {
      fileCount += 1;
      totalBytes += entryStat.size;
    }
  }

  return { fileCount, totalBytes };
}

await rm(outputDirectory, { recursive: true, force: true });

// Image dimensions must be known before templates render so that srcset
// candidates and intrinsic sizes never upscale an original photograph.
await loadSourceIndex();

const eleventy = new Eleventy(".", "_site", {
  configPath: "eleventy.config.js",
});

await eleventy.write();

const imageStats = await generateSiteImages();

const artifact = await collectArtifactStats(outputDirectory);
const sizeInMiB = (artifact.totalBytes / 1024 ** 2).toFixed(2);

console.log(
  `Built ${artifact.fileCount} files into _site (${sizeInMiB} MiB).`,
);
console.log(
  [
    `Images: ${imageStats.derivativeCount} derivatives + ${imageStats.graphicCount} graphics`,
    `${imageStats.derivativeCacheHits} from cache`,
    `${imageStats.originalCount} originals copied`,
    `${imageStats.referenceCount} references verified`,
  ].join(", "),
);

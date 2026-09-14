import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import Eleventy from "@11ty/eleventy";
import { generateSiteImages, loadSourceIndex } from "./image-pipeline.mjs";

const projectRoot = process.cwd();
// The output directory defaults to _site. SITE_ROOT can point somewhere outside
// a cloud-synced working copy (OneDrive placeholders can lock generated files).
const outputDirectory = path.resolve(projectRoot, process.env.SITE_ROOT ?? "_site");

const isDefaultOutput = outputDirectory === path.join(projectRoot, "_site");
const isExplicitOutput =
  Boolean(process.env.SITE_ROOT) &&
  outputDirectory !== projectRoot &&
  path.dirname(path.dirname(outputDirectory)) !== outputDirectory;

if (!isDefaultOutput && !isExplicitOutput) {
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
    const entryStat = await statWithRetry(entryPath);
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

// Cloud-synced folders can briefly lock generated files; retry transient errors.
async function statWithRetry(target, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await stat(target);
    } catch (error) {
      if (error.code === "ENOENT") {
        return null;
      }
      if (!["EPERM", "EBUSY", "EACCES"].includes(error.code) || attempt === attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  return null;
}

/**
 * Clears the previous build. Cloud-synced folders (OneDrive) can hold brief
 * locks on generated files, so removal is retried with backoff before giving
 * up.
 */
async function cleanOutputDirectory(directory) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!["EPERM", "EBUSY", "EACCES", "UNKNOWN"].includes(error.code)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw new Error(
    `Could not clean ${directory} after 6 attempts (${lastError.code}: ${lastError.message}). ` +
      "A syncing tool is holding the generated files open.",
  );
}

await cleanOutputDirectory(outputDirectory);

// Image dimensions must be known before templates render so that srcset
// candidates and intrinsic sizes never upscale an original photograph.
await loadSourceIndex();

const eleventy = new Eleventy(".", outputDirectory, {
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

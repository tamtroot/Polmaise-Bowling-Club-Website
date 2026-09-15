import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { IMAGE_EXTENSIONS } from "./image-pipeline.mjs";

/**
 * Stage 6 source-image integrity, Stage 16 platform fix.
 *
 * The archive under `Images/` is the club's photographic record: the build must
 * never mutate or lose an original. `reports/stage6/source-image-manifest.json`
 * records every file the pipeline found, and this module compares the recorded
 * byte sizes against the working tree.
 *
 * Only files with a **supported raster extension** are protected originals.
 * The manifest also lists the notes and helper files that live beside the
 * photographs (`Readme.md`, `thumbsremove.ps1`) and the two SVG sponsor logos.
 * Those are text: git normalises their line endings on checkout, so a Windows
 * recording (CRLF) does not match a Linux CI checkout (LF) even though nothing
 * has been mutated. Comparing them was a false positive that only ever fired on
 * CI, so they are excluded from the *mutation* check while still being allowed
 * to deploy (the deployed-file check below uses the full manifest).
 */

/** True when the manifest path is a source photograph the pipeline protects. */
export function isProtectedSourceImage(relativePath, extensions = IMAGE_EXTENSIONS) {
  const extension = path.posix.extname(String(relativePath).split(path.sep).join("/")).toLowerCase();
  return extensions.has(extension);
}

/** Read the Stage 6 manifest (`{ entries: { "Images/…": { bytes, sha256 } } }`). */
export async function readSourceImageManifest(manifestPath) {
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

/**
 * Compare the manifest against the working tree.
 *
 * `statFile` is injectable so the regression tests can drive the comparison
 * without writing thousands of files.
 */
export async function compareSourceImages({
  entries,
  projectRoot,
  extensions = IMAGE_EXTENSIONS,
  statFile = (filePath) => stat(filePath).catch(() => null),
}) {
  const missingOriginals = [];
  const changedOriginals = [];
  const originalStems = new Set();
  const unmanagedEntries = [];
  let protectedCount = 0;

  for (const [relativePath, entry] of Object.entries(entries ?? {})) {
    if (!isProtectedSourceImage(relativePath, extensions)) {
      unmanagedEntries.push(relativePath);
      continue;
    }

    protectedCount += 1;
    const originalPath = path.join(projectRoot, relativePath);
    const originalStat = await statFile(originalPath);

    if (!originalStat) {
      missingOriginals.push(relativePath);
      continue;
    }
    if (originalStat.size !== entry.bytes) {
      changedOriginals.push(`${relativePath}: ${entry.bytes} -> ${originalStat.size}`);
    }
    // `-wNNN` derivatives may only be built from a real source photograph.
    originalStems.add(relativePath.replace(/\.[^.]+$/, ""));
  }

  return { missingOriginals, changedOriginals, originalStems, protectedCount, unmanagedEntries };
}

/**
 * The deployed half of the Stage 6 rule: everything the site serves from
 * `_site/Images` must be either a recorded original (logos and SVGs are copied
 * verbatim) or a `-wNNN` derivative of a protected source photograph.
 */
export function classifyDeployedImage(comparablePath, { manifestEntries, originalStems }) {
  if (manifestEntries[comparablePath]) return "original";
  const derivative = comparablePath.match(/^(.*)-w\d+(\.[a-z0-9]+)$/i);
  if (derivative && originalStems.has(derivative[1])) return "derivative";
  return "unexpected";
}

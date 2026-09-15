import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  classifyDeployedImage,
  compareSourceImages,
  isProtectedSourceImage,
  readSourceImageManifest,
} from "../tools/verify-source-images.mjs";
import { SOURCE_ROOT } from "./helpers/site-root.mjs";

/**
 * Stage 6 source-image integrity — the protection that proves the build never
 * mutates the club's photographic archive.
 *
 * Stage 16 regression: the check used to compare *every* file in the manifest,
 * including the notes and helper scripts that sit beside the photographs. Those
 * are text files, so git's line-ending normalisation gave them different byte
 * sizes on a Linux CI checkout than on the Windows machine that recorded the
 * manifest, and the release gate failed on files that were never protected in
 * the first place.
 *
 * These tests pin both halves of the rule: non-image files are ignored, and a
 * genuinely mutated photograph still fails.
 */
const realManifestPath = path.join(SOURCE_ROOT, "reports", "stage6", "source-image-manifest.json");

test.describe("source-image integrity", () => {
  test("ignores non-image files that live beside the photographs", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "polmaise-integrity-"));
    try {
      await mkdir(path.join(directory, "Images", "notes"), { recursive: true });
      await mkdir(path.join(directory, "Images", "photos"), { recursive: true });
      // A Windows checkout has "\r\n" (2 bytes) here; a Linux one has "\n" (1).
      await writeFile(path.join(directory, "Images", "notes", "Readme.md"), "\n", "utf8");
      await writeFile(path.join(directory, "Images", "photos", "team.jpg"), "0123456789", "utf8");

      const result = await compareSourceImages({
        entries: {
          "Images/notes/Readme.md": { bytes: 2, sha256: "recorded-on-windows" },
          "Images/photos/team.jpg": { bytes: 10, sha256: "unchanged" },
        },
        projectRoot: directory,
      });

      expect(result.changedOriginals).toEqual([]);
      expect(result.missingOriginals).toEqual([]);
      expect(result.unmanagedEntries).toEqual(["Images/notes/Readme.md"]);
      expect(result.protectedCount).toBe(1);
      // Only the photograph contributes a stem for derivative lookups.
      expect([...result.originalStems]).toEqual(["Images/photos/team"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("still fails when a real source image is mutated or missing", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "polmaise-integrity-"));
    try {
      await mkdir(path.join(directory, "Images", "photos"), { recursive: true });
      await writeFile(path.join(directory, "Images", "photos", "team.jpg"), "0123456789X", "utf8");

      const mutated = await compareSourceImages({
        entries: { "Images/photos/team.jpg": { bytes: 10, sha256: "recorded" } },
        projectRoot: directory,
      });
      expect(mutated.changedOriginals).toEqual(["Images/photos/team.jpg: 10 -> 11"]);

      const missing = await compareSourceImages({
        entries: {
          "Images/photos/team.jpg": { bytes: 11, sha256: "fine" },
          "Images/photos/final.webp": { bytes: 4, sha256: "recorded" },
        },
        projectRoot: directory,
      });
      expect(missing.missingOriginals).toEqual(["Images/photos/final.webp"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("protects the whole photographic archive in the real manifest", async () => {
    const manifest = await readSourceImageManifest(realManifestPath);
    const result = await compareSourceImages({
      entries: manifest.entries,
      projectRoot: SOURCE_ROOT,
    });

    // Nothing recorded has been lost or edited.
    expect(result.missingOriginals).toEqual([]);
    expect(result.changedOriginals).toEqual([]);

    // The protection covers the archive, not a token handful of files.
    const manifestEntries = Object.keys(manifest.entries);
    expect(result.protectedCount).toBeGreaterThan(1800);
    expect(result.protectedCount).toBe(manifestEntries.length - result.unmanagedEntries.length);
    for (const relativePath of result.unmanagedEntries) {
      expect(isProtectedSourceImage(relativePath)).toBe(false);
    }

    // Every protected path is a supported raster image.
    for (const relativePath of manifestEntries) {
      if (!isProtectedSourceImage(relativePath)) continue;
      expect(relativePath).toMatch(/\.(?:jpe?g|png|webp|gif|avif)$/i);
    }
  });

  test("accepts recorded originals and their derivatives, and nothing else", async () => {
    const manifestEntries = {
      "Images/photos/team.jpg": { bytes: 10 },
      "Images/hamilton.svg": { bytes: 20 },
    };
    const originalStems = new Set(["Images/photos/team"]);

    // Copied originals (including non-raster logos) are expected.
    expect(classifyDeployedImage("Images/photos/team.jpg", { manifestEntries, originalStems })).toBe(
      "original",
    );
    expect(classifyDeployedImage("Images/hamilton.svg", { manifestEntries, originalStems })).toBe(
      "original",
    );
    // Derivatives must belong to a protected photograph.
    expect(
      classifyDeployedImage("Images/photos/team-w800.webp", { manifestEntries, originalStems }),
    ).toBe("derivative");
    // Anything else is a build leak.
    expect(
      classifyDeployedImage("Images/photos/stranger-w800.webp", { manifestEntries, originalStems }),
    ).toBe("unexpected");
  });

  test("uses the pipeline's own list of source formats", async () => {
    const { IMAGE_EXTENSIONS } = await import("../tools/image-pipeline.mjs");

    for (const extension of IMAGE_EXTENSIONS) {
      expect(isProtectedSourceImage(`Images/photo${extension}`)).toBe(true);
      expect(isProtectedSourceImage(`Images/photo${extension.toUpperCase()}`)).toBe(true);
    }
    for (const other of [".md", ".ps1", ".svg", ".txt", ".json"]) {
      expect(isProtectedSourceImage(`Images/notes${other}`)).toBe(false);
    }

    // The comparison is platform independent: Windows-style separators resolve
    // to the same extension.
    expect(isProtectedSourceImage("Images\\photos\\team.JPG")).toBe(true);
    expect(await stat(realManifestPath)).toBeTruthy();
  });
});

import { readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/*
 * Compares each failed visual-regression "actual" screenshot with its accepted
 * baseline and reports how large the difference is and where it sits.
 *
 * Baselines are per platform (`…-desktop-<platform>.png`, see
 * `playwright.config.js`), so the accepted set is resolved with
 * `process.platform` unless `--platform=<name>` says otherwise.
 */
const argument = (name, fallback) => {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
};

const root = process.cwd();
const platform = argument("platform", process.platform);
const testResultsRoot = path.join(root, "test-results");
const baselineRoot = path.join(root, "tests", "__screenshots__", "visual-regression.spec.js");

async function findActualScreenshots(directory, found = []) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await findActualScreenshots(fullPath, found);
    } else if (entry.name.endsWith("-actual.png")) {
      found.push(fullPath);
    }
  }
  return found;
}

async function pixelsOf(filePath) {
  const { data, info } = await sharp(filePath).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

const actualScreenshots = await findActualScreenshots(testResultsRoot);
const report = [];

for (const actualPath of actualScreenshots) {
  const match = path.basename(actualPath).match(/^(.*)-actual\.png$/);
  if (!match) {
    continue;
  }
  const name = match[1];
  const project = path.basename(path.dirname(actualPath)).match(/-([a-z]+)$/)?.[1];
  const baselinePath = path.join(baselineRoot, `${name}-${project}-${platform}.png`);

  const [expected, actual] = await Promise.all([
    pixelsOf(baselinePath).catch(() => null),
    pixelsOf(actualPath),
  ]);
  if (!expected) {
    continue;
  }

  const width = Math.min(expected.width, actual.width);
  const height = Math.min(expected.height, actual.height);
  let differingPixels = 0;
  let totalDelta = 0;
  let maxDelta = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const differingRows = new Set();

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const expectedOffset = (y * expected.width + x) * expected.channels;
      const actualOffset = (y * actual.width + x) * actual.channels;
      const delta = Math.max(
        Math.abs(expected.data[expectedOffset] - actual.data[actualOffset]),
        Math.abs(expected.data[expectedOffset + 1] - actual.data[actualOffset + 1]),
        Math.abs(expected.data[expectedOffset + 2] - actual.data[actualOffset + 2]),
      );
      if (delta <= 2) {
        continue;
      }
      differingPixels += 1;
      totalDelta += delta;
      maxDelta = Math.max(maxDelta, delta);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      differingRows.add(y);
    }
  }

  report.push({
    name,
    project,
    screenshotSize: `${actual.width}x${actual.height}`,
    differingPixels,
    differingRows: differingRows.size,
    changedRegion:
      differingPixels > 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
    meanChannelDelta: differingPixels > 0 ? Number((totalDelta / differingPixels).toFixed(1)) : 0,
    maxChannelDelta: maxDelta,
  });
}

console.log(JSON.stringify(report, null, 2));

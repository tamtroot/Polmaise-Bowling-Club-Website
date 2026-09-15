import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/*
 * Stage 16: review one platform's visual baselines against another.
 *
 * Screenshots are platform-specific: the DOM lays out identically, but Chromium
 * rasterises text with the platform's own stack (DirectWrite/ClearType on
 * Windows, FreeType/fontconfig on Linux), so the same page produces slightly
 * different pixels. The deployment gate therefore compares Linux against Linux
 * (`tests/__screenshots__/**-linux.png`), and this tool answers the question
 * that sits between *generating* that set and *committing* it: how do the two
 * platforms differ?
 *
 * For every pair it reports the screenshot size, how many pixels differ, where
 * they sit, and — the part that decides the review — whether a small
 * whole-image shift explains the difference (a layout difference that deserves
 * a look) or nothing does (rasterisation of the same geometry).
 *
 * It is a review aid and it never writes a baseline; the PNGs and the functional
 * layout assertions (header collisions, navigation hit targets, page audits) are
 * the authority. Usage:
 *
 *   node tools/compare-visual-baselines.mjs                        # linux vs win32
 *   node tools/compare-visual-baselines.mjs --platform=linux --against=win32
 *   node tools/compare-visual-baselines.mjs --report=reports/latest/visual-baseline-review.json
 *   node tools/compare-visual-baselines.mjs --root=<dir>            # verify the tool itself
 */
const argument = (name, fallback) => {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
};

const baselineRoot = path.resolve(
  argument("root", path.join("tests", "__screenshots__", "visual-regression.spec.js")),
);
const platform = argument("platform", "linux");
const against = argument("against", platform === "linux" ? "win32" : "linux");
const reportPath = path.resolve(
  argument("report", path.join("reports", "latest", "visual-baseline-review.json")),
);

/** A channel counts as different past the fixtures' own 2/255 tolerance. */
const CHANNEL_TOLERANCE = 2;
/** A layout difference shows up as a small whole-image shift. */
const SEARCH_RADIUS = 3;
/**
 * ...and has to leave this little of the difference behind to be called one.
 * Rasterisation of the same geometry never aligns away: the difference *is* the
 * rendering, so it survives every offset. A real layout shift does align away.
 */
const SHIFT_RESIDUAL = 0.15;
/** Above this share of differing pixels the pair is worth a human look. */
const REVIEW_RATIO = 0.25;

const read = async (file) => {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
};

/**
 * Compares two images, optionally with `right` shifted by (dx, dy), over the
 * pixels the two have in common: `left(x, y)` against `right(x + dx, y + dy)`.
 * `regions` also reports where the differences sit.
 */
const compare = (left, right, { dx = 0, dy = 0, regions = false } = {}) => {
  const startX = Math.max(0, -dx);
  const startY = Math.max(0, -dy);
  const endX = Math.min(left.width, right.width - dx);
  const endY = Math.min(left.height, right.height - dy);
  let differing = 0;
  let total = 0;
  let sumDelta = 0;
  let maxDelta = 0;
  let minX = endX;
  let minY = endY;
  let maxX = -1;
  let maxY = -1;
  const rows = new Set();
  const columns = new Set();

  for (let y = startY; y < endY; y += 1) {
    const leftRow = y * left.width;
    const rightRow = (y + dy) * right.width;
    for (let x = startX; x < endX; x += 1) {
      const leftOffset = (leftRow + x) * left.channels;
      const rightOffset = (rightRow + x + dx) * right.channels;
      const delta = Math.max(
        Math.abs(left.data[leftOffset] - right.data[rightOffset]),
        Math.abs(left.data[leftOffset + 1] - right.data[rightOffset + 1]),
        Math.abs(left.data[leftOffset + 2] - right.data[rightOffset + 2]),
      );
      total += 1;
      if (delta <= CHANNEL_TOLERANCE) continue;
      differing += 1;
      sumDelta += delta;
      maxDelta = Math.max(maxDelta, delta);
      if (!regions) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      rows.add(y);
      columns.add(x);
    }
  }

  return {
    differing,
    total,
    ratio: total === 0 ? 0 : differing / total,
    meanDelta: differing === 0 ? 0 : Number((sumDelta / differing).toFixed(1)),
    maxDelta,
    changedRegion:
      differing === 0 || !regions
        ? null
        : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    differingRows: regions ? rows.size : null,
    differingColumns: regions ? columns.size : null,
  };
};

/**
 * The image's ink profile: how much ink sits in each row and each column. Whole
 * rows and columns move together when a page shifts, so correlating profiles
 * finds a shift without being fooled by sampling gaps.
 */
const profile = (image) => {
  const rows = new Float64Array(image.height);
  const columns = new Float64Array(image.width);
  for (let y = 0; y < image.height; y += 1) {
    const rowOffset = y * image.width;
    let rowInk = 0;
    for (let x = 0; x < image.width; x += 1) {
      const offset = (rowOffset + x) * image.channels;
      const ink = (image.data[offset] + image.data[offset + 1] + image.data[offset + 2]) / 3;
      rowInk += ink;
      columns[x] += ink;
    }
    rows[y] = rowInk;
  }
  return { rows, columns };
};

/** The lag in [-radius, radius] at which two profiles line up best. */
const bestLag = (left, right, radius) => {
  let best = { lag: 0, error: Infinity };
  for (let lag = -radius; lag <= radius; lag += 1) {
    const start = Math.max(0, -lag);
    const end = Math.min(left.length, right.length - lag);
    let error = 0;
    let count = 0;
    for (let index = start; index < end; index += 1) {
      const delta = left[index] - right[index + lag];
      error += delta * delta;
      count += 1;
    }
    if (count === 0) continue;
    const normalised = error / count;
    if (normalised < best.error) best = { lag, error: normalised };
  }
  return best.lag;
};

/**
 * Whether a small whole-image shift explains the difference: the profiles give
 * the candidate offset, and the full-pixel residual after aligning decides it.
 */
const shiftEvidence = (left, right, baseline) => {
  const leftProfile = profile(left);
  const rightProfile = profile(right);
  const dy = bestLag(leftProfile.rows, rightProfile.rows, SEARCH_RADIUS);
  const dx = bestLag(leftProfile.columns, rightProfile.columns, SEARCH_RADIUS);
  if (dx === 0 && dy === 0) {
    return { dx: 0, dy: 0, explained: 0, residual: 1 };
  }
  const aligned = compare(left, right, { dx, dy });
  const residual = baseline.differing === 0 ? 1 : aligned.differing / baseline.differing;
  return { dx, dy, explained: Number((1 - residual).toFixed(3)), residual };
};

const entries = await readdir(baselineRoot, { withFileTypes: true }).catch(() => []);
const pairs = new Map();
for (const entry of entries) {
  if (!entry.isFile()) continue;
  const match =
    /^(?<name>.+)-(?<project>desktop|tablet|mobile)-(?<platform>[a-z0-9]+)\.png$/.exec(entry.name);
  if (!match) continue;
  const key = `${match.groups.name}-${match.groups.project}`;
  const record = pairs.get(key) ?? { name: key };
  record[match.groups.platform] = path.join(baselineRoot, entry.name);
  pairs.set(key, record);
}

const report = [];
for (const key of [...pairs.keys()].sort()) {
  const record = pairs.get(key);
  const leftFile = record[platform];
  const rightFile = record[against];
  if (!leftFile || !rightFile) {
    report.push({
      name: key,
      verdict: "missing",
      missing: leftFile ? against : platform,
    });
    continue;
  }

  const [left, right] = await Promise.all([read(leftFile), read(rightFile)]);
  if (left.width !== right.width || left.height !== right.height) {
    report.push({
      name: key,
      verdict: "size",
      [platform]: `${left.width}x${left.height}`,
      [against]: `${right.width}x${right.height}`,
    });
    continue;
  }

  const stats = compare(left, right, { regions: true });
  const shift = shiftEvidence(left, right, stats);
  const verdict =
    stats.differing === 0
      ? "identical"
      : (shift.dx !== 0 || shift.dy !== 0) && shift.residual <= SHIFT_RESIDUAL
        ? "shift"
        : stats.ratio > REVIEW_RATIO
          ? "review"
          : "rasterisation";

  report.push({
    name: key,
    verdict,
    size: `${left.width}x${left.height}`,
    differingPixels: stats.differing,
    differingRatio: Number(stats.ratio.toFixed(4)),
    differingRows: stats.differingRows,
    differingColumns: stats.differingColumns,
    changedRegion: stats.changedRegion,
    meanChannelDelta: stats.meanDelta,
    maxChannelDelta: stats.maxDelta,
    bestOffset: { dx: shift.dx, dy: shift.dy },
    explainedByOffset: shift.explained,
    residualAfterOffset: Number(shift.residual.toFixed(3)),
  });
}

const counts = report.reduce((totals, pair) => {
  totals[pair.verdict] = (totals[pair.verdict] ?? 0) + 1;
  return totals;
}, {});

console.log(`visual baselines: ${platform} vs ${against} (${baselineRoot})`);
console.log(
  Object.entries(counts)
    .map(([verdict, count]) => `${count} ${verdict}`)
    .join(", ") || "no baseline pairs found",
);
for (const pair of report) {
  let detail;
  if (pair.verdict === "missing") {
    detail = `no ${pair.missing} baseline`;
  } else if (pair.verdict === "size") {
    detail = `${platform} ${pair[platform]} vs ${against} ${pair[against]}`;
  } else {
    const sign = (value) => `${value >= 0 ? "+" : ""}${value}`;
    detail =
      `${pair.differingPixels} px differ (${(pair.differingRatio * 100).toFixed(2)}%), ` +
      `mean Δ${pair.meanChannelDelta}/max Δ${pair.maxChannelDelta}; ` +
      `best offset ${sign(pair.bestOffset.dx)},${sign(pair.bestOffset.dy)} removes ` +
      `${(pair.explainedByOffset * 100).toFixed(0)}% (leaves ${(pair.residualAfterOffset * 100).toFixed(0)}%)`;
  }
  console.log(`  ${pair.verdict.padEnd(14)} ${pair.name.padEnd(44)} ${detail}`);
}
console.log(
  "\nReview the PNGs before committing: 'shift', 'size', 'review' and 'missing' all need a human look.",
);

await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(
  reportPath,
  `${JSON.stringify({ platform, against, counts, pairs: report }, null, 2)}\n`,
  "utf8",
);
console.log(`report: ${reportPath}`);

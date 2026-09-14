import { readFile } from "node:fs/promises";
import path from "node:path";

// Compares two layout fingerprints captured with tools/capture-layout.mjs.
// Geometry is compared as a multiset of element boxes (robust to elements being
// added or removed) plus the document scroll height for every page/viewport.
const [beforeLabel = "before", afterLabel = "after"] = process.argv.slice(2);
const reportsRoot = path.join(process.cwd(), "reports", "latest");

const before = JSON.parse(
  await readFile(path.join(reportsRoot, `layout-${beforeLabel}.json`), "utf8"),
);
const after = JSON.parse(
  await readFile(path.join(reportsRoot, `layout-${afterLabel}.json`), "utf8"),
);

const describe = (value) => value.split("|")[0];
const boxOf = (value) => value.split("|")[1];
// Stage 7 added a <main> landmark wrapper; it moves nothing.
const isTransparentWrapper = (value) => describe(value).startsWith("main");

const countBoxes = (entries) => {
  const counts = new Map();
  for (const entry of entries.filter((value) => !isTransparentWrapper(value))) {
    const key = boxOf(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

const report = {
  capturesCompared: 0,
  capturesWithGeometryChanges: 0,
  scrollHeightChanges: [],
  maxScrollHeightDelta: 0,
  boxCountsAdded: 0,
  boxCountsRemoved: 0,
  imageBoxChangeCount: 0,
  imageBoxChanges: [],
  elementCountMismatches: [],
};

for (const beforePage of before.pages) {
  const label = `${beforePage.path} ${beforePage.viewport}`;
  const afterPage = after.pages.find(
    (page) => page.path === beforePage.path && page.viewport === beforePage.viewport,
  );
  if (!afterPage) {
    report.elementCountMismatches.push(`${label}: missing after capture`);
    continue;
  }

  report.capturesCompared += 1;

  const beforeCount = beforePage.elements.filter((value) => !isTransparentWrapper(value)).length;
  const afterCount = afterPage.elements.filter((value) => !isTransparentWrapper(value)).length;
  if (beforeCount !== afterCount) {
    report.elementCountMismatches.push(`${label}: ${beforeCount} -> ${afterCount}`);
  }

  const heightDelta = Math.abs(afterPage.scrollHeight - beforePage.scrollHeight);
  report.maxScrollHeightDelta = Math.max(report.maxScrollHeightDelta, heightDelta);
  if (heightDelta > 0.5) {
    report.scrollHeightChanges.push({
      capture: label,
      before: beforePage.scrollHeight,
      after: afterPage.scrollHeight,
      delta: Number((afterPage.scrollHeight - beforePage.scrollHeight).toFixed(2)),
    });
  }

  const beforeBoxes = countBoxes(beforePage.elements);
  const afterBoxes = countBoxes(afterPage.elements);
  let added = 0;
  let removed = 0;
  for (const [box, count] of afterBoxes) {
    added += Math.max(0, count - (beforeBoxes.get(box) ?? 0));
  }
  for (const [box, count] of beforeBoxes) {
    removed += Math.max(0, count - (afterBoxes.get(box) ?? 0));
  }
  report.boxCountsAdded += added;
  report.boxCountsRemoved += removed;

  if (added > 0 || removed > 0 || heightDelta > 0.5) {
    report.capturesWithGeometryChanges += 1;
  }

  const imageCount = Math.min(beforePage.images.length, afterPage.images.length);
  for (let index = 0; index < imageCount; index += 1) {
    const beforeImage = beforePage.images[index];
    const afterImage = afterPage.images[index];
    if (
      beforeImage.displayed[0] !== afterImage.displayed[0] ||
      beforeImage.displayed[1] !== afterImage.displayed[1]
    ) {
      report.imageBoxChanges.push({
        capture: label,
        source: afterImage.src,
        before: beforeImage.displayed,
        after: afterImage.displayed,
      });
    }
  }
}

report.maxScrollHeightDelta = Number(report.maxScrollHeightDelta.toFixed(2));
report.imageBoxChangeCount = report.imageBoxChanges.length;
report.imageBoxChanges = report.imageBoxChanges.slice(0, 15);
report.scrollHeightChanges = report.scrollHeightChanges.slice(0, 15);
report.elementCountMismatches = report.elementCountMismatches.slice(0, 15);

console.log(JSON.stringify(report, null, 2));

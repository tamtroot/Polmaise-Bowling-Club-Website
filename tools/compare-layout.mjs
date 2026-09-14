import { readFile } from "node:fs/promises";
import path from "node:path";

// Compares two layout fingerprints captured with tools/capture-layout.mjs and
// reports geometry drift: element positions/sizes, image boxes and page text.
const [beforeLabel = "before", afterLabel = "after"] = process.argv.slice(2);
const reportsRoot = path.join(process.cwd(), "reports", "latest");

const before = JSON.parse(await readFile(path.join(reportsRoot, `layout-${beforeLabel}.json`), "utf8"));
const after = JSON.parse(await readFile(path.join(reportsRoot, `layout-${afterLabel}.json`), "utf8"));

const parseBox = (value) => value.split("|")[1]?.split(",").map(Number) ?? null;
const describe = (value) => value.split("|")[0];

const report = {
  capturesCompared: 0,
  capturesWithAnyDifference: 0,
  elementCountMismatches: [],
  textMismatches: [],
  movedElements: [],
  imageBoxChanges: [],
  maxDeltaPx: 0,
  maxContainerDeltaPx: 0,
  imagesUnloaded: [],
};

for (const beforePage of before.pages) {
  const afterPage = after.pages.find(
    (page) => page.path === beforePage.path && page.viewport === beforePage.viewport,
  );
  if (!afterPage) {
    report.elementCountMismatches.push(`${beforePage.path} ${beforePage.viewport}: missing capture`);
    continue;
  }

  report.capturesCompared += 1;
  let pageHasDifference = false;

  if (beforePage.elements.length !== afterPage.elements.length) {
    report.elementCountMismatches.push(
      `${beforePage.path} ${beforePage.viewport}: ${beforePage.elements.length} -> ${afterPage.elements.length}`,
    );
    pageHasDifference = true;
  }

  if (beforePage.textHash !== afterPage.textHash) {
    report.textMismatches.push(`${beforePage.path} ${beforePage.viewport}`);
    pageHasDifference = true;
  }

  const count = Math.min(beforePage.elements.length, afterPage.elements.length);
  for (let index = 0; index < count; index += 1) {
    const beforeElement = beforePage.elements[index];
    const afterElement = afterPage.elements[index];
    const beforeBox = parseBox(beforeElement);
    const afterBox = parseBox(afterElement);
    if (!beforeBox || !afterBox) {
      continue;
    }

    const deltas = beforeBox.map((value, position) => Math.abs(value - afterBox[position]));
    const maxDelta = Math.max(...deltas);
    if (maxDelta > 0.01) {
      pageHasDifference = true;
      report.maxDeltaPx = Math.max(report.maxDeltaPx, maxDelta);
      const descriptor = describe(afterElement);
      const isContainer = /^(section|main|div|footer|header|body)/.test(descriptor);
      if (isContainer) {
        report.maxContainerDeltaPx = Math.max(report.maxContainerDeltaPx, maxDelta);
      }
      report.movedElements.push({
        page: beforePage.path,
        viewport: beforePage.viewport,
        element: descriptor,
        before: beforeBox,
        after: afterBox,
        maxDelta: Number(maxDelta.toFixed(2)),
      });
    }
  }

  const imageCount = Math.min(beforePage.images.length, afterPage.images.length);
  for (let index = 0; index < imageCount; index += 1) {
    const beforeImage = beforePage.images[index];
    const afterImage = afterPage.images[index];
    const changed =
      beforeImage.displayed[0] !== afterImage.displayed[0] ||
      beforeImage.displayed[1] !== afterImage.displayed[1];

    if (changed) {
      pageHasDifference = true;
      report.imageBoxChanges.push({
        page: beforePage.path,
        viewport: beforePage.viewport,
        source: afterImage.src,
        before: beforeImage.displayed,
        after: afterImage.displayed,
        loadedBefore: beforeImage.complete,
        loadedAfter: afterImage.complete,
      });
    }

    if (!afterImage.complete) {
      report.imagesUnloaded.push({
        page: afterPage.path,
        viewport: afterPage.viewport,
        source: afterImage.src,
      });
    }
  }

  if (pageHasDifference) {
    report.capturesWithAnyDifference += 1;
  }
}

report.movedElements.sort((left, right) => right.maxDelta - left.maxDelta);

console.log(JSON.stringify({
  capturesCompared: report.capturesCompared,
  capturesWithAnyDifference: report.capturesWithAnyDifference,
  elementCountMismatches: report.elementCountMismatches,
  textMismatches: report.textMismatches,
  maxDeltaPx: Number(report.maxDeltaPx.toFixed(2)),
  maxContainerDeltaPx: Number(report.maxContainerDeltaPx.toFixed(2)),
  movedElementCount: report.movedElements.length,
  imageBoxChangeCount: report.imageBoxChanges.length,
  unloadedImageCount: report.imagesUnloaded.length,
  worstMoves: report.movedElements.slice(0, 8),
  worstImageBoxes: report.imageBoxChanges
    .map((change) => ({ ...change, delta: Math.max(
      Math.abs(change.before[0] - change.after[0]),
      Math.abs(change.before[1] - change.after[1]),
    ) }))
    .sort((left, right) => right.delta - left.delta)
    .slice(0, 8),
}, null, 2));

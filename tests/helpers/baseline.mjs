import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";

const projectRoot = process.cwd();
const baselineRoot = path.join(projectRoot, "reports", "baseline");
const latestRoot = path.join(projectRoot, "reports", "latest");

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normaliseItems(items) {
  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))].sort();
}

function isUpdateRun(testInfo) {
  return testInfo.config.metadata?.updateBaseline === true;
}

export async function compareOrUpdateBaseline(testInfo, name, currentItems) {
  const items = normaliseItems(currentItems);
  const baselinePath = path.join(baselineRoot, `${name}.json`);
  const latestPath = path.join(latestRoot, "baselines", `${name}.json`);
  const report = { name, items };

  await writeJson(latestPath, report);

  let baseline;
  try {
    baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  } catch {
    baseline = null;
  }

  if (!baseline || isUpdateRun(testInfo)) {
    await writeJson(baselinePath, report);
    return { newItems: [], resolvedItems: [] };
  }

  const baselineItems = new Set(baseline.items ?? []);
  const currentItemSet = new Set(items);
  const newItems = items.filter((item) => !baselineItems.has(item));
  const resolvedItems = [...baselineItems].filter((item) => !currentItemSet.has(item));

  if (resolvedItems.length > 0) {
    await writeJson(path.join(latestRoot, "resolved", `${name}.json`), {
      name,
      items: resolvedItems,
    });
  }

  if (newItems.length > 0) {
    await testInfo.attach(`${name}-new-items.json`, {
      body: JSON.stringify(newItems, null, 2),
      contentType: "application/json",
    });

    const preview = newItems.slice(0, 20).join("\n");
    const overflow =
      newItems.length > 20 ? `\n...and ${newItems.length - 20} more` : "";
    expect(
      newItems,
      `New baseline items were detected for ${name}:\n${preview}${overflow}`,
    ).toEqual([]);
  }

  return { newItems, resolvedItems };
}

export async function writeMeasurement(name, value) {
  const baselinePath = path.join(baselineRoot, "measurements", `${name}.json`);
  const latestPath = path.join(latestRoot, "measurements", `${name}.json`);

  await writeJson(baselinePath, value);
  await writeJson(latestPath, value);
}

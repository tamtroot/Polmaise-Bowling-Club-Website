import { createRequire } from "node:module";
import { test } from "@playwright/test";
import { compareOrUpdateBaseline, writeMeasurement } from "./helpers/baseline.mjs";
import { SITE_PAGES } from "./helpers/site-pages.mjs";

const require = createRequire(import.meta.url);
const axeSource = require("axe-core").source;

function formatLocation(location) {
  if (!location.url) {
    return "";
  }

  return ` (${location.url}:${location.lineNumber ?? 0}:${location.columnNumber ?? 0})`;
}

function summariseResources(resources) {
  const types = new Map();

  for (const resource of resources) {
    const current = types.get(resource.resourceType) ?? {
      count: 0,
      bytes: 0,
    };
    current.count += 1;
    current.bytes += resource.bytes;
    types.set(resource.resourceType, current);
  }

  return {
    resourceCount: resources.length,
    totalBytes: resources.reduce((total, resource) => total + resource.bytes, 0),
    byType: Object.fromEntries(
      [...types.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
    largestResources: [...resources]
      .sort((left, right) => right.bytes - left.bytes)
      .slice(0, 25),
    resources: [...resources].sort((left, right) => left.url.localeCompare(right.url)),
  };
}

test.describe("page audit baseline", () => {
  for (const sitePage of SITE_PAGES) {
    test(`${sitePage.label} audit`, async ({ page, baseURL }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "Page audits run once on desktop");

      const consoleErrors = [];
      const pageErrors = [];
      const failedRequests = [];
      const responseTasks = new Map();

      page.on("console", (message) => {
        if (message.type() === "error") {
          consoleErrors.push(`${message.text()}${formatLocation(message.location())}`);
        }
      });

      page.on("pageerror", (error) => {
        pageErrors.push(error.stack ?? error.message);
      });

      page.on("requestfailed", (request) => {
        failedRequests.push(
          `${request.method()} ${request.url()} - ${request.failure()?.errorText ?? "unknown failure"}`,
        );
      });

      page.on("response", (response) => {
        const url = response.url();
        if (!baseURL || !url.startsWith(baseURL) || responseTasks.has(url)) {
          return;
        }

        responseTasks.set(
          url,
          response
            .body()
            .then((body) => ({
              url,
              bytes: body.length,
              status: response.status(),
              resourceType: response.request().resourceType(),
              contentType: response.headers()["content-type"] ?? "",
            }))
            .catch(() => null),
        );
      });

      const response = await page.goto(sitePage.path, {
        waitUntil: "domcontentloaded",
      });

      if (!response) {
        throw new Error(`No response received for ${sitePage.path}`);
      }

      await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(750);

      await page.addScriptTag({ content: axeSource });
      const axeViolations = await page.evaluate(async () => {
        const results = await window.axe.run(document, {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
          },
        });

        return results.violations.map((violation) => {
          const targets = violation.nodes
            .flatMap((node) => node.target)
            .slice(0, 5)
            .join(" | ");

          return `${violation.id} | impact=${violation.impact ?? "unknown"} | nodes=${violation.nodes.length} | targets=${targets}`;
        });
      });

      const resources = (await Promise.all(responseTasks.values())).filter(Boolean);
      const measurements = summariseResources(resources);

      await compareOrUpdateBaseline(
        testInfo,
        `page-audit/${sitePage.name}/console-errors`,
        consoleErrors,
      );
      await compareOrUpdateBaseline(
        testInfo,
        `page-audit/${sitePage.name}/page-errors`,
        pageErrors,
      );
      await compareOrUpdateBaseline(
        testInfo,
        `page-audit/${sitePage.name}/failed-requests`,
        failedRequests,
      );
      await compareOrUpdateBaseline(
        testInfo,
        `page-audit/${sitePage.name}/axe-violations`,
        axeViolations,
      );

      await writeMeasurement(`page-weights/${sitePage.name}`, {
        page: sitePage,
        viewport: page.viewportSize(),
        status: response.status(),
        ...measurements,
      });
    });
  }
});

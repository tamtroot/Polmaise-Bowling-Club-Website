import { readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "@playwright/test";
import { HtmlValidate } from "html-validate";
import { compareOrUpdateBaseline, writeMeasurement } from "./helpers/baseline.mjs";

const projectRoot = process.cwd();
const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "playwright-report",
  "reports",
  "test-results",
  "tests",
  "tools",
]);

async function findHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findHtmlFiles(fullPath)));
    } else if (entry.name.toLowerCase().endsWith(".html")) {
      files.push(fullPath);
    }
  }

  return files;
}

test("HTML validation baseline", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "HTML validation runs once on desktop");

  const htmlValidate = new HtmlValidate({
    extends: ["html-validate:recommended"],
  });
  const htmlFiles = await findHtmlFiles(projectRoot);
  const findings = [];

  for (const filePath of htmlFiles) {
    const report = await htmlValidate.validateFile(filePath);
    for (const result of report.results) {
      for (const message of result.messages) {
        findings.push({
          file: path.relative(projectRoot, filePath),
          ruleId: message.ruleId,
          severity: message.severity === 2 ? "error" : "warning",
          message: message.message,
          line: message.line,
          column: message.column,
          selector: message.selector,
        });
      }
    }
  }

  const fingerprints = findings.map(
    (finding) =>
      `${finding.file} | ${finding.severity} | ${finding.ruleId} | ${finding.message}`,
  );

  await compareOrUpdateBaseline(
    testInfo,
    "html-validation/issues",
    fingerprints,
  );
  await writeMeasurement("html-validation", {
    pagesChecked: htmlFiles.length,
    errorCount: findings.filter((finding) => finding.severity === "error").length,
    warningCount: findings.filter((finding) => finding.severity === "warning").length,
    ruleCounts: Object.fromEntries(
      [...new Set(findings.map((finding) => finding.ruleId))]
        .sort()
        .map((ruleId) => [
          ruleId,
          findings.filter((finding) => finding.ruleId === ruleId).length,
        ]),
    ),
    findings,
  });
});

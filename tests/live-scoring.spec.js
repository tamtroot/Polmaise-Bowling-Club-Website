import { expect, test } from "@playwright/test";
import { freezeBaselineClock } from "./helpers/baseline-clock.mjs";

/**
 * Stage 16 — Live Scores resilience.
 *
 * The scoreboard is a third-party cross-origin embed that has been known to
 * return HTTP 401. Nothing on our side can read a cross-origin frame's
 * contents or status, so the requirements are:
 *
 *   - the page must never look broken because the service is unavailable;
 *   - the copy must be honest (it may not claim the board is fine);
 *   - when the board cannot load at all, a fallback message stands in for it;
 *   - the embed is still used when it works.
 *
 * The failure case is simulated by leaving the embed request pending forever,
 * which is the one failure mode the page can actually detect: a frame that never
 * finishes loading. (A cross-origin 401 still fires `load`, which is why the
 * page copy — not the fallback panel — has to carry that case.)
 */
const LIVE_SCORING_PATH = "/live-scoring.html";
const EMBED_URL = "https://polmaise-bowls-live.base44.app/embed";

test.describe("live scoring page", () => {
  test("keeps the embed and explains itself honestly", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Content checks run once");

    await freezeBaselineClock(page);
    await page.goto(LIVE_SCORING_PATH, { waitUntil: "domcontentloaded" });

    const frame = page.locator("#liveScoreboard iframe");
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute("src", EMBED_URL);
    await expect(frame).toHaveAttribute("title", /Live Scores/);

    // The page must not promise that the board is working.
    const intro = await page.locator(".live-scoring-intro").innerText();
    expect(intro).toContain("If the board does not load");
    expect(intro).toContain("check back later for match updates");
    expect(intro).not.toContain("no live games at the moment");

    // Manual link out stays available, and the fallback panel starts hidden.
    await expect(page.getByRole("link", { name: /Open live scores in a new tab/ })).toBeVisible();
    await expect(page.locator("#liveScoringUnavailable")).toBeHidden();
  });

  test("stands in for the board when it cannot load", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Failure simulation runs once");

    // 10s fallback timer plus the click/assert budget.
    test.setTimeout(60_000);

    // Never resolve the embed request: the frame stays loading, so the page's
    // "never arrived" timer is what reveals the panel.
    await page.route(EMBED_URL, () => {});
    await freezeBaselineClock(page);
    await page.goto(LIVE_SCORING_PATH, { waitUntil: "domcontentloaded" });

    const panel = page.locator("#liveScoringUnavailable");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel).toContainText("Live scoring is currently unavailable");
    await expect(panel).toContainText("Please check back later for match updates");
    await expect(panel.getByRole("link", { name: /open the scoreboard in a new tab/i })).toBeVisible();

    // The frame is hidden rather than left as an empty box, and the rest of the
    // page still works.
    await expect(page.locator("#liveScoreboard iframe")).toBeHidden();
    await expect(page.getByRole("button", { name: /Expand scoreboard/ })).toBeVisible();
    await expect(page.locator("footer")).toBeVisible();
  });

  test("the expand/exit scoreboard controls still work", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Interaction check runs once");

    await page.route(EMBED_URL, (route) => route.abort());
    await freezeBaselineClock(page);
    await page.goto(LIVE_SCORING_PATH, { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: /Expand scoreboard/ }).click();
    await expect(page.locator("body")).toHaveClass(/scoreboard-expanded/);
    await expect(page.getByRole("button", { name: /Expand scoreboard/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByRole("button", { name: /Exit full screen/ }).click();
    await expect(page.locator("body")).not.toHaveClass(/scoreboard-expanded/);
  });
});

const BASELINE_TIME = new Date("2026-09-13T12:00:00Z");

export async function freezeBaselineClock(page) {
  await page.clock.setFixedTime(BASELINE_TIME);
}

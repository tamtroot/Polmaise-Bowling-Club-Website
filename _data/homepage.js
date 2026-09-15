import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { buildToday, isPlaceholder, parseFixtureDate } from "../tools/fixture-schedule.mjs";

/**
 * Derived data for the redesigned homepage (Stage 12).
 *
 * The homepage is assembled from the same structured sources the rest of the
 * site uses — `_data/fixtures.json`, `_data/gallery.json`,
 * `_data/sponsors.json` — plus the curated editorial index in
 * `_data/homepageContent.json` (hero, latest-result, history and membership copy that already
 * exists on news.html / history.html / membership.html). Nothing is duplicated
 * into index.html and no club facts are invented here.
 */
const projectRoot = process.cwd();

const readJson = (relativePath) =>
  JSON.parse(readFileSync(path.join(projectRoot, relativePath), "utf8"));

/*
 * Fixture dates ("04-Apr", ranges as "08-Aug to 15-Aug") and the build-time
 * "today" are shared with the fixtures page through _data/fixtureSchedule.js,
 * so the homepage and the fixture list can never disagree about which fixture
 * is next. Items without a usable date or competition (the placeholders in the
 * club's list) are left out of the homepage schedule.
 */

/**
 * The club's most recent album covers, without duplicating gallery data.
 *
 * An album may nominate a `coverImage` (src + alt) when the first photograph in
 * the album is not the most representative one — appending a photo to an album
 * would otherwise silently change the homepage. Without a nominated cover we
 * fall back to the first full-size original in the album, and only then to the
 * first "-thumb" derivative.
 */
function galleryStrip(gallery, limit = 6) {
  return (gallery.albums ?? [])
    .map((album) => {
      if (album.coverImage?.src) {
        return {
          src: album.coverImage.src,
          alt: album.coverImage.alt || album.title,
          title: album.title,
          href: "gallery.html",
        };
      }
      const images = (album.sections ?? []).flatMap((section) => section.images ?? []);
      const image = images.find((entry) => !/-thumb\./i.test(entry.src)) ?? images[0];
      if (!image) return null;
      return {
        src: image.src,
        alt: image.alt || album.title,
        title: album.title,
        href: "gallery.html",
      };
    })
    .filter(Boolean)
    .slice(0, limit);
}

/** Club sponsors that have a logo, in the order the sponsors page lists them. */
function sponsorStrip(sponsors, limit = 6) {
  return (sponsors.club ?? [])
    .filter((sponsor) => sponsor.logo?.src)
    .slice(0, limit)
    .map((sponsor) => ({
      name: sponsor.name,
      logo: sponsor.logo,
    }));
}

export default function homepageData() {
  // Read by path rather than relying on Eleventy's `homepage` data namespace:
  // two files sharing a base name would be merged into one namespace.
  const homepage = readJson("_data/homepageContent.json");
  const fixtures = readJson("_data/fixtures.json");
  const gallery = readJson("_data/gallery.json");
  const sponsors = readJson("_data/sponsors.json");

  const season = Number(fixtures.season) || new Date().getFullYear();
  const withDates = (fixtures.items ?? [])
    .filter((item) => !isPlaceholder(item.competition))
    .map((item) => ({ ...item, dateValue: parseFixtureDate(item.date, season) }))
    .filter((item) => item.dateValue);

  const today = buildToday();
  const past = withDates
    .filter((item) => item.dateValue < today)
    .sort((left, right) => right.dateValue - left.dateValue);
  let upcoming = withDates
    .filter((item) => item.dateValue >= today)
    .sort((left, right) => left.dateValue - right.dateValue);

  /*
   * Test-only data state. The regression tests build a second copy of the site
   * with STAGE12_TEST_FIXTURES pointing at a small synthetic fixture list, so
   * the "Next Fixture" and "This Week at the Club" layouts can be exercised
   * even though the real 2026 season is complete. Production builds never set
   * this variable, so the synthetic fixtures cannot reach the published site —
   * a test asserts exactly that.
   */
  let testFixtures = false;
  const overridePath = process.env.STAGE12_TEST_FIXTURES;
  if (overridePath && existsSync(overridePath)) {
    const synthetic = JSON.parse(readFileSync(overridePath, "utf8"));
    upcoming = synthetic
      .map((item) => ({ ...item, dateValue: parseFixtureDate(item.date, season) }))
      .filter((item) => item.dateValue)
      .sort((left, right) => left.dateValue - right.dateValue);
    testFixtures = true;
  }

  return {
    season,
    testFixtures,
    hero: homepage.hero,
    latestResult: homepage.latestResult,
    history: homepage.history,
    membership: homepage.membership,
    nextFixture: upcoming[0] ?? null,
    upcoming: upcoming.slice(0, 4),
    seasonComplete: upcoming.length === 0,
    lastPlayed: past[0] ?? null,
    galleryStrip: galleryStrip(gallery),
    sponsorStrip: sponsorStrip(sponsors),
  };
}

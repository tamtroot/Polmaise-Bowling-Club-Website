import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import posthtml from "posthtml";

/**
 * Stage 13 — structural tidy-up of the migrated article bodies.
 *
 * The article bodies were lifted verbatim out of the old single news page,
 * which had drifted into invalid HTML: 43 of them left a <div> unclosed.
 * Browsers therefore parsed the end of the document differently from the
 * template that wrote it, which is how the previous/next navigation ended up
 * nested inside `.article-body` (and inherited that column's width) instead of
 * sitting beside it. The same markup was the source of the HTML validation
 * report's "unclosed element", "implicitly closed" and "stray end tag" items.
 *
 * The fix is a parse-and-re-render round trip through an HTML parser, which
 * applies exactly the tree-building rules a browser uses: blocks that cannot
 * live inside a <p> close it, list items close each other, and every element is
 * written back with an explicit end tag. Raw "&" characters are escaped so the
 * result also validates.
 *
 * The article *text* is not touched: the tool compares the visible text before
 * and after and refuses to write a file whose copy changed.
 *
 * Usage:
 *   node tools/normalise-news-markup.mjs            # write the files
 *   node tools/normalise-news-markup.mjs --check    # report drift only
 */

const projectRoot = process.cwd();
const newsRoot = path.join(projectRoot, "news");
const isCheckOnly = process.argv.includes("--check");

/** Escape "&" that is not already an entity (text nodes and attributes). */
function escapeAmpersands(value) {
  return value.replace(
    /&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});)/g,
    "&amp;",
  );
}

const RELATIVE_URL = /^(?![a-z][a-z0-9+.-]*:|\/|\.|#)/i;

/**
 * The bodies were written for a page at the site root, so links such as
 * `href="gallery.html"` broke as soon as the article moved three directories
 * deep. Any reference that is not already absolute, dot-relative or a URL
 * scheme is rooted at the site root, which resolves the same from every depth.
 */
function rootRelativeUrl(value) {
  if (typeof value !== "string" || !RELATIVE_URL.test(value.trim())) return value;
  return `/${value.trim().replace(/^\.\//, "")}`;
}

function tidyTree(nodes) {
  for (const node of nodes) {
    if (typeof node === "string") continue;
    if (!node) continue;

    // posthtml exposes attributes as `attrs` (its renderer reads that too).
    const attributes = node.attrs ?? node.attribs;
    if (attributes) {
      for (const [name, value] of Object.entries(attributes)) {
        if (typeof value !== "string") continue;
        if (name === "href" || name === "src") {
          attributes[name] = escapeAmpersands(rootRelativeUrl(value));
          continue;
        }
        if (name === "srcset") {
          attributes[name] = escapeAmpersands(
            value
              .split(",")
              .map((candidate) => {
                const [url, ...descriptor] = candidate.trim().split(/\s+/);
                return [rootRelativeUrl(url), ...descriptor].join(" ").trim();
              })
              .join(", "),
          );
          continue;
        }
        attributes[name] = escapeAmpersands(value);
      }
    }

    if (Array.isArray(node.content)) {
      node.content = node.content.map((child) =>
        typeof child === "string" ? escapeAmpersands(child) : child,
      );
      tidyTree(node.content);
    }
  }
}

/**
 * Article bodies may contain Nunjucks calls (the `photoImage` shortcode). Those
 * are template code, not markup: they are swapped for inert placeholders before
 * parsing so a file path such as `Gary&Rita1.jpg` inside a shortcode is never
 * entity-escaped, then put back exactly as written.
 */
function protectTemplateCode(source) {
  const tokens = [];
  const protectedSource = source.replace(
    /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}/g,
    (match) => {
      tokens.push(match);
      return `\uE000${tokens.length - 1}\uE001`;
    },
  );

  return {
    protectedSource,
    restore: (html) =>
      html.replace(/\uE000(\d+)\uE001/g, (match, index) => tokens[Number(index)] ?? match),
  };
}

const render = async (source) => {
  const { protectedSource, restore } = protectTemplateCode(source);
  const result = await posthtml([
    (tree) => {
      // posthtml hands the plugin the root node's children.
      tidyTree(tree);
      return tree;
    },
  ]).process(protectedSource, { closingSingleTag: "default", quoteAllAttributes: true });

  return `${restore(result.html)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .trim()}\n`;
};

/** Visible text, used to prove the rewrite never edits the copy. */
const visibleText = (html) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

function splitFrontMatter(source) {
  const match = source.match(/^---\r?\n[\s\S]*?\r?\n---/);
  if (!match) throw new Error("Article is missing a front-matter block");
  return { frontMatter: match[0], body: source.slice(match[0].length) };
}

const files = [];
for (const entry of await readdir(newsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = path.join(newsRoot, entry.name);
  for (const file of await readdir(directory, { withFileTypes: true })) {
    if (file.isFile() && file.name.endsWith(".md")) {
      files.push(path.join(directory, file.name));
    }
  }
}
files.sort();

const changed = [];
const problems = [];

for (const file of files) {
  const relative = path.relative(projectRoot, file).split(path.sep).join("/");
  const source = await readFile(file, "utf8");
  const { frontMatter, body } = splitFrontMatter(source);

  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const normalisedBody = (await render(body)).split("\n").join(eol);
  const next = `${frontMatter}${eol}${normalisedBody}`;

  if (visibleText(next) !== visibleText(source)) {
    problems.push(`${relative}: visible text changed — left untouched`);
    continue;
  }
  if (next === source) continue;

  changed.push(relative);
  if (!isCheckOnly) {
    await writeFile(file, next, "utf8");
  }
}

for (const problem of problems) {
  console.error(`PROBLEM ${problem}`);
}

console.log(
  `${isCheckOnly ? "Would rewrite" : "Rewrote"} ${changed.length} of ${files.length} article bodies`,
);
for (const file of changed) {
  console.log(`  ${file}`);
}

if (problems.length > 0) {
  process.exitCode = 1;
}

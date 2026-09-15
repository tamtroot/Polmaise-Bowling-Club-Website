/**
 * Stage 15 — card excerpts for the historical archive.
 *
 * Archive rows show the article's own `excerpt` (the sentence-level extract
 * written for cards and search results). Some of the historical items are long
 * single sentences, so this trims to the first complete sentences when an
 * excerpt would not fit comfortably in a row — and never cuts a sentence, a
 * clause or a word in half, and never adds an ellipsis or new wording.
 */

/** A period after one of these is not a sentence break. */
const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "rev",
  "st",
  "no",
  "jr",
  "sr",
  "co",
  "ltd",
  "capt",
  "col",
  "gen",
  "lieut",
  "sgt",
  "hon",
]);

/** Split on sentence-ending punctuation, ignoring initials and abbreviations. */
export function splitSentences(text) {
  const sentences = [];
  let start = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character !== "." && character !== "!" && character !== "?") continue;

    const next = text[index + 1];
    if (next && next !== " " && next !== '"' && next !== "”") continue;

    if (character === ".") {
      const before = text.slice(0, index);
      const word = before.match(/([A-Za-z]+)$/)?.[1]?.toLowerCase();
      const previousCharacter = before.at(-1);
      // "J. Gwynne", "Mr. Smith", "St. Ninians" continue the sentence.
      if (word && ABBREVIATIONS.has(word)) continue;
      if (previousCharacter && /[A-Z]/.test(previousCharacter) && word && word.length === 1) continue;
      if (/^\s*[a-z]/.test(text.slice(index + 1))) continue;
    }

    sentences.push(text.slice(start, index + 1).trim());
    start = index + 1;
  }

  const remainder = text.slice(start).trim();
  if (remainder) sentences.push(remainder);
  return sentences.filter(Boolean);
}

/**
 * The first complete sentences, up to `maxChars` (and never more than
 * `maxSentences`). A single sentence longer than the limit is returned whole.
 */
export function cardExcerpt(text, { maxChars = 240, maxSentences = 3 } = {}) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;

  const sentences = splitSentences(clean);
  let excerpt = "";
  let used = 0;

  for (const sentence of sentences) {
    if (used >= maxSentences) break;
    if (excerpt && excerpt.length + 1 + sentence.length > maxChars) break;
    excerpt = excerpt ? `${excerpt} ${sentence}` : sentence;
    used += 1;
    if (excerpt.length >= maxChars) break;
  }

  return excerpt || sentences[0] || clean;
}

/**
 * Turning a stored full name into the first name the product speaks to people
 * in: "Book Priya again", "Nothing is charged until Priya accepts."
 *
 * Four places derived this as `full_name.split(" ")[0]`, and a teacher who
 * registered as "Mr. Azad" — which the tutor signup form accepts and stores
 * verbatim — came out as "Mr." in all four:
 *
 *   "Book Mr. again"                        (student sessions list)
 *   "Nothing is charged until Mr. accepts." (teacher card, beside the price)
 *   "More about Mr."                        (teacher card, phone)
 *   "Mr. isn't available right now."        (teachers list banner)
 *
 * Found on 2026-09-14 by looking at a real teacher's card. Stripping on the
 * way OUT rather than validating on the way IN, deliberately: teachers who
 * have already registered are not re-prompted, nothing needs migrating, and a
 * tutor who genuinely wants the honorific on their profile keeps it — it is
 * only dropped where the product is addressing them by first name.
 */

/**
 * Leading titles dropped before taking the first name. English and the Indian
 * honorifics this product actually sees, since it teaches CBSE/ICSE/State
 * Board students. Matched case-insensitively and with or without the dot.
 *
 * Deliberately NOT a general "short word" rule: a two-letter first name is a
 * real name, and guessing would mangle it.
 */
const HONORIFICS = new Set([
  "mr",
  "mrs",
  "ms",
  "mx",
  "miss",
  "dr",
  "prof",
  "professor",
  "sir",
  "shri",
  "sri",
  "smt",
  "sh",
]);

const isHonorific = (token: string) =>
  HONORIFICS.has(token.toLowerCase().replace(/\.$/, ""));

/**
 * The first name to address someone by, with any leading honorifics removed.
 *
 * Returns the trimmed input when there is nothing else to fall back on — a
 * name recorded as nothing BUT an honorific ("Dr.") still has to render as
 * something, and "Dr." reads far better there than an empty string in the
 * middle of a sentence about money.
 */
export function firstName(fullName: string): string {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";

  let i = 0;
  // A loop, not a single check: "Prof. Dr. Rao" carries two.
  while (i < tokens.length && isHonorific(tokens[i])) i++;

  // Every token was a title. Keep what was stored rather than render nothing.
  if (i === tokens.length) return tokens.join(" ");

  return tokens[i];
}

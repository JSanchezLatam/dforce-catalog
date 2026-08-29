/**
 * customers/near-match.ts — pure relaxation for the "zero exact matches"
 * second search pass (R19). `src/modules/customers/queries.ts` stays
 * untouched (proposal.md's rollback boundary); this module only produces a
 * broader term the route re-runs `listClientes`/`countClientes` with.
 *
 * Two strategies, chosen by shape:
 *  - a term made only of digits and phone-typical separators (`+`, space,
 *    `-`, parens) relaxes to its last 7 digits (matches
 *    `validation.ts`'s `PHONE_MIN_DIGITS`) — the national significant
 *    number, so a leading country code or stray punctuation stops mattering;
 *  - anything else (name/plate) relaxes to a shorter prefix: the first word
 *    when the term has more than one, otherwise its first two-thirds.
 * Returns `null` when the term is too short to relax meaningfully, which
 * tells the caller to skip the second query entirely.
 */
const PHONE_CHARS = /^[+\d\s()-]+$/;
const PHONE_KEY_LENGTH = 7;
const MIN_PREFIX_LENGTH = 3;

export function relaxSearchTerm(term: string): string | null {
  const trimmed = term.trim();
  if (!trimmed) return null;

  if (PHONE_CHARS.test(trimmed)) {
    const digits = trimmed.replace(/\D/g, "");
    return digits.length >= PHONE_KEY_LENGTH ? digits.slice(-PHONE_KEY_LENGTH) : null;
  }

  const firstSpace = trimmed.indexOf(" ");
  const prefix = firstSpace > 0 ? trimmed.slice(0, firstSpace) : trimmed.slice(0, Math.floor((trimmed.length * 2) / 3));
  return prefix.length >= MIN_PREFIX_LENGTH && prefix.length < trimmed.length ? prefix : null;
}

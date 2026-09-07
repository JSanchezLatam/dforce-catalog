/**
 * User-facing copy shared across write surfaces. Rioplatense Spanish, per
 * AGENTS.md's audience split — the identifiers here are English, the strings
 * are not.
 *
 * Only strings that MUST be identical everywhere belong here. Copy that reads
 * the same in two screens by coincidence stays where it is rendered: pulling it
 * here would couple two screens that are free to diverge.
 */

/**
 * What every write surface says when `fetch` REJECTS — a dropped connection, a
 * DNS failure, an aborted request — as opposed to returning a non-ok response.
 *
 * It was copied by hand into FIVE places before it lived here —
 * `ForcedPasswordChangeForm`, `UserForm`, `UsersTable`, `CustomerForm` and
 * `ServiceOrderForm`. `OrderStatusControls` is the sixth site and held no
 * literal at all, because it was still missing its `catch` entirely. Five
 * literals are four chances for one to be corrected alone, and an app that
 * phrases the same failure two ways stops reading as one product.
 *
 * **Tests assert the literal, not this constant, deliberately.** A test that
 * imports what the component imports cannot catch a bad edit to it — both
 * sides move together and the assertion passes. Keeping the string spelled out
 * in the test is what makes changing this one a decision rather than an
 * accident.
 *
 * That net only holds if every assertion carries the WHOLE sentence, and
 * three of them did not: two matched the prefix
 * (`toHaveTextContent("No se pudo conectar")`) and one matched three words
 * (`/no se pudo/i`). Rewriting only the tail left those files green — 4 tests
 * red instead of 7. All three were widened to the full string when this
 * constant was extracted, and it is now measured rather than asserted:
 * replacing the whole sentence and replacing only its tail both turn the SAME
 * 7 tests red across the same 6 files.
 */
export const CONNECTION_ERROR = "No se pudo conectar. Revisa tu conexión e intenta de nuevo.";

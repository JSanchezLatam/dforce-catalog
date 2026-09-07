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
 * It was copied by hand into six places before it lived here (both account
 * forms, `UsersTable`, `CustomerForm`, `ServiceOrderForm`, and the status
 * controls that were still missing their `catch` entirely). Six literals is
 * five chances for one of them to be corrected alone, and an app that phrases
 * the same failure two ways stops reading as one product.
 *
 * **Tests assert the literal, not this constant, deliberately.** A test that
 * imports what the component imports cannot catch a bad edit to it — both
 * sides move together and the assertion passes. Keeping the string spelled out
 * in the test is what makes changing this one a decision rather than an
 * accident.
 */
export const CONNECTION_ERROR = "No se pudo conectar. Revisa tu conexión e intenta de nuevo.";

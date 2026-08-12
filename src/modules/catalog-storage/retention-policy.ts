/**
 * The retention limit, in a leaf module with no DB import — same reason
 * `account/password-policy.ts` and `catalog-builder/price-lists.ts` are leaf
 * modules.
 *
 * `retention.ts` imports `@/shared/db/client`, so a `"use client"` component
 * that reaches in for this constant drags the Postgres driver into the browser
 * bundle and the build dies with `Module not found: Can't resolve 'dns'`. The
 * number has to live somewhere both sides can read.
 */
export const RETENTION_LIMIT = 2; // R11.2 — max catalogs kept per user

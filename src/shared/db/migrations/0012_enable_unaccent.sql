-- Extension-only migration: no table change, so the Drizzle snapshot is
-- identical to 0011's. `ilike` folds case but NOT accents, so a customer
-- named 'María GONZÁLEZ' is unreachable by staff typing 'maria gonzalez'.
-- `buildClienteSearchWhere` (src/modules/customers/queries.ts) now wraps both
-- the column and the pattern in `unaccent()`, which needs this extension.
--
-- `unaccent` is a trusted extension on PG 13+, so the app's own role can
-- create it — no superuser step. IF NOT EXISTS keeps re-runs safe.
CREATE EXTENSION IF NOT EXISTS unaccent;

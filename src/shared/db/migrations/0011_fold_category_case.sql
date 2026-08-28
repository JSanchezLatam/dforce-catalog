-- Data-only migration: no schema change, so the Drizzle snapshot is identical
-- to 0010's. Backfills the category case fold that `parseProduct` now applies
-- in `src/modules/inventory-sync/mapper.ts` (trim -> uppercase -> '' becomes
-- NULL), so rows written before that projection stop showing up as a second,
-- identical-looking filter option and catalog row until their next sync.
UPDATE "producto" SET
  "category_l1" = nullif(upper(trim("category_l1")), ''),
  "category_l2" = nullif(upper(trim("category_l2")), '');

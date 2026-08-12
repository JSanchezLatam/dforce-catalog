ALTER TABLE "template_config" ADD COLUMN "selected_template_id" text;--> statement-breakpoint
ALTER TABLE "workshop_config" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "workshop_config" ADD COLUMN "whatsapp" text;--> statement-breakpoint
ALTER TABLE "workshop_config" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "workshop_config" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "workshop_config" ADD COLUMN "hours" text;--> statement-breakpoint
ALTER TABLE "workshop_config" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "workshop_config" ADD COLUMN "cover_text" text;--> statement-breakpoint
ALTER TABLE "workshop_config" ADD COLUMN "social_handles" jsonb;--> statement-breakpoint
-- Hand-appended: `coverText` moves from `template_config` to `workshop_config`
-- (design.md D5). Preserve the owner's already-typed cover text instead of
-- discarding it — `template_config.cover_text` stays NOT NULL and untouched
-- until it is dropped in migration 0009 (WU3).
--
-- `workshop_config` has no seed row: it only ever gets one through the
-- app's lazy upsert (saveWorkshopConfig). An Administrador can configure
-- branding (template_config, NOT NULL columns, so a row means real data)
-- without ever touching workshop settings — the UPDATE below would then
-- match zero rows and migration 0009 would drop template_config.cover_text
-- with nothing to show for it. Ensure the singleton exists first.
-- `template_config.id` has no DB-level default or singleton constraint —
-- app code (template-config/service.ts) always reads/writes the literal id
-- 'singleton'. `ORDER BY ... LIMIT 1` would pick an arbitrary row if an
-- abandoned second row ever existed; matching the app's own key exactly is
-- both simpler and correct regardless of how many rows the table holds.
INSERT INTO "workshop_config" ("id") VALUES ('singleton') ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "workshop_config" SET "cover_text" = (SELECT "cover_text" FROM "template_config" WHERE "id" = 'singleton') WHERE "cover_text" IS NULL;

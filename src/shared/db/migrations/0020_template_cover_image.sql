CREATE TABLE "template_cover_image" (
	"template_id" text PRIMARY KEY NOT NULL,
	"r2_key" text NOT NULL,
	"content_type" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Backfill (same expand-step pattern as 0013): the one shared cover photo
-- becomes Clasico's own. "Portada completa" starts with no photo on purpose,
-- and there is no runtime fallback to workshop_config afterwards.
-- ON CONFLICT DO NOTHING keeps a re-run from overwriting a photo the admin
-- has since replaced.
INSERT INTO "template_cover_image" ("template_id", "r2_key", "content_type", "updated_at")
SELECT 'dforce-classic', "cover_image_r2_key", "cover_image_content_type", now()
FROM "workshop_config"
WHERE "cover_image_r2_key" IS NOT NULL
ON CONFLICT ("template_id") DO NOTHING;

CREATE TABLE "usage_daily" (
	"day" date NOT NULL,
	"screen" text NOT NULL,
	"role_group" text NOT NULL,
	"views" integer NOT NULL,
	CONSTRAINT "usage_daily_day_screen_role_group_pk" PRIMARY KEY("day","screen","role_group"),
	CONSTRAINT "usage_daily_role_group" CHECK ("usage_daily"."role_group" in ('gestion', 'tecnico'))
);
--> statement-breakpoint
CREATE TABLE "usage_delivery" (
	"id" smallint PRIMARY KEY NOT NULL,
	"acked_through" date,
	CONSTRAINT "usage_delivery_single_row" CHECK ("usage_delivery"."id" = 1)
);
--> statement-breakpoint
-- The one watermark row; NULL = nothing acknowledged yet (delivery starts from the oldest usage_daily.day).
INSERT INTO "usage_delivery" ("id") VALUES (1);

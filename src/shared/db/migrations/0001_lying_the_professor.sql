CREATE TYPE "public"."sync_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "producto" (
	"id" text PRIMARY KEY NOT NULL,
	"raw" jsonb NOT NULL,
	"name" text NOT NULL,
	"category_l1" text,
	"category_l2" text,
	"price" real,
	"stock" integer,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "sync_status" DEFAULT 'running' NOT NULL,
	"product_count" integer,
	"error" text
);
--> statement-breakpoint
CREATE INDEX "producto_category_idx" ON "producto" USING btree ("category_l1","category_l2");--> statement-breakpoint
CREATE INDEX "producto_name_idx" ON "producto" USING btree ("name");
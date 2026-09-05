CREATE TYPE "public"."customer_import_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "customer_import_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "customer_import_status" DEFAULT 'running' NOT NULL,
	"created" integer,
	"updated" integer,
	"skipped_count" integer,
	"error" text
);

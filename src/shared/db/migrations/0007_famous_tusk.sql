-- Hand-edited: renamed role value in-place (Drizzle's generated DROP/CREATE
-- approach is destructive and unnecessary — ALTER TYPE ... RENAME VALUE is
-- the correct non-destructive path per design Decision 1a). The `UPDATE`
-- backfill below populates `name` from existing `username` values.
ALTER TYPE "public"."role" RENAME VALUE 'usuario' TO 'tecnico';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'tecnico';--> statement-breakpoint
CREATE TABLE "workshop_config" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"name" text,
	"logo_r2_key" text,
	"logo_content_type" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");--> statement-breakpoint
UPDATE "users" SET "name" = "username" WHERE "name" IS NULL;--> statement-breakpoint

CREATE TYPE "public"."upload_status" AS ENUM('pending', 'uploading', 'uploaded', 'failed');--> statement-breakpoint
CREATE TABLE "catalogs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"categories" jsonb NOT NULL,
	"products_per_page" integer NOT NULL,
	"upload_status" "upload_status" DEFAULT 'pending' NOT NULL,
	"r2_key" text,
	"r2_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalogs_user_created_idx" ON "catalogs" USING btree ("user_id","created_at");
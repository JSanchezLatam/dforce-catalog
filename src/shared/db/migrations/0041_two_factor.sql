CREATE TYPE "public"."second_factor" AS ENUM('totp', 'recovery', 'trusted_device');--> statement-breakpoint
CREATE TYPE "public"."session_pending" AS ENUM('verify', 'enroll');--> statement-breakpoint
ALTER TYPE "public"."login_outcome" ADD VALUE 'password_ok';--> statement-breakpoint
ALTER TYPE "public"."login_outcome" ADD VALUE 'bad_code';--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_totp" (
	"user_id" text PRIMARY KEY NOT NULL,
	"secret_sealed" text NOT NULL,
	"enabled_at" timestamp with time zone,
	"last_step" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "login_attempts" ADD COLUMN "second_factor" "second_factor";--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "pending" "session_pending";--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_totp" ADD CONSTRAINT "user_totp_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recovery_codes_user_id_idx" ON "recovery_codes" USING btree ("user_id");
CREATE TABLE "support_feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"role" text NOT NULL,
	"category" text NOT NULL,
	"text" text NOT NULL,
	"route" text NOT NULL,
	"screen_label" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'nuevo' NOT NULL,
	"internal_note" text DEFAULT '' NOT NULL,
	CONSTRAINT "support_feedback_status_check" CHECK ("support_feedback"."status" in ('nuevo', 'leido', 'resuelto'))
);
--> statement-breakpoint
CREATE TABLE "support_login_throttle" (
	"ip" text PRIMARY KEY NOT NULL,
	"failures" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "support_feedback_created_at_idx" ON "support_feedback" USING btree ("created_at" DESC NULLS LAST);
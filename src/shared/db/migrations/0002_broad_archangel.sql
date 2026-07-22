CREATE TABLE "template_config" (
	"id" text PRIMARY KEY NOT NULL,
	"logo_url" text NOT NULL,
	"primary_colors" jsonb NOT NULL,
	"font" text NOT NULL,
	"cover_text" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

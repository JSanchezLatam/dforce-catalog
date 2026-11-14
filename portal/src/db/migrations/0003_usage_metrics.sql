CREATE TABLE "usage_count" (
	"day" date NOT NULL,
	"screen" text NOT NULL,
	"role_group" text NOT NULL,
	"views" integer NOT NULL,
	CONSTRAINT "usage_count_day_screen_role_group_pk" PRIMARY KEY("day","screen","role_group"),
	CONSTRAINT "usage_count_role_group_check" CHECK ("usage_count"."role_group" in ('gestion', 'tecnico'))
);
--> statement-breakpoint
CREATE TABLE "usage_coverage" (
	"day" date PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_screen" (
	"pattern" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL
);

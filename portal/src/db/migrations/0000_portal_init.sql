CREATE TABLE "portal_customer" (
	"cliente_id" text PRIMARY KEY NOT NULL,
	"token_hash" text,
	"snapshot" jsonb,
	"version" bigint NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_customer_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "portal_terms_acceptance" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"terms_version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "cliente" ADD COLUMN "portal_token" text;--> statement-breakpoint
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_portal_token_unique" UNIQUE("portal_token");
ALTER TABLE "orden_servicio" ADD COLUMN "urgente_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orden_servicio" ADD COLUMN "urgente_by" text;--> statement-breakpoint
ALTER TABLE "orden_servicio" ADD CONSTRAINT "orden_servicio_urgente_by_users_id_fk" FOREIGN KEY ("urgente_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orden_servicio" ADD CONSTRAINT "orden_urgente_by_needs_at" CHECK ("orden_servicio"."urgente_by" IS NULL OR "orden_servicio"."urgente_at" IS NOT NULL);
ALTER TABLE "orden_servicio" ADD COLUMN "kilometraje" integer;--> statement-breakpoint
ALTER TABLE "orden_servicio" ADD COLUMN "nivel_combustible" smallint;--> statement-breakpoint
ALTER TABLE "orden_servicio" ADD COLUMN "bateria_pct" smallint;--> statement-breakpoint
ALTER TABLE "orden_servicio" ADD CONSTRAINT "orden_kilometraje_range" CHECK ("orden_servicio"."kilometraje" between 0 and 2000000);--> statement-breakpoint
ALTER TABLE "orden_servicio" ADD CONSTRAINT "orden_nivel_combustible_range" CHECK ("orden_servicio"."nivel_combustible" between 0 and 4);--> statement-breakpoint
ALTER TABLE "orden_servicio" ADD CONSTRAINT "orden_bateria_pct_range" CHECK ("orden_servicio"."bateria_pct" between 0 and 100);
-- `::text`: migrate() runs every pending file in ONE transaction with 0033, which adds the enum values this CHECK names.
-- A literal comparison would fail with "unsafe use of new value" (same reason as 0033).
ALTER TABLE "orden_servicio" ALTER COLUMN "vehiculo_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orden_servicio" ALTER COLUMN "categoria" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orden_servicio" ADD CONSTRAINT "orden_vehiculo_categoria_required" CHECK ("orden_servicio"."status"::text IN ('booked', 'cancelled') OR ("orden_servicio"."vehiculo_id" IS NOT NULL AND "orden_servicio"."categoria" IS NOT NULL));
CREATE TYPE "public"."orden_categoria" AS ENUM('instalacion', 'mant_preventivo', 'mant_correctivo', 'reparacion', 'revisado');--> statement-breakpoint
ALTER TABLE "orden_servicio" ADD COLUMN "vehiculo_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "orden_servicio" ADD COLUMN "categoria" "orden_categoria" NOT NULL;--> statement-breakpoint
ALTER TABLE "orden_servicio" ADD COLUMN "hallazgos" text;--> statement-breakpoint
ALTER TABLE "orden_servicio" ADD COLUMN "recomendaciones" text;--> statement-breakpoint
ALTER TABLE "orden_servicio" ADD COLUMN "observaciones" text;--> statement-breakpoint
ALTER TABLE "orden_servicio" ADD CONSTRAINT "orden_servicio_vehiculo_id_vehiculo_id_fk" FOREIGN KEY ("vehiculo_id") REFERENCES "public"."vehiculo"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orden_vehiculo_created_idx" ON "orden_servicio" USING btree ("vehiculo_id","created_at");